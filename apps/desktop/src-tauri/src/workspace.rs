// src-tauri/src/workspace.rs
use std::collections::HashMap;
use std::sync::Mutex;

use std::path::{Path, PathBuf};

use tauri::Manager;

use crate::watcher::{self, FsWatcherState};

pub struct WorkspaceState(pub Mutex<HashMap<String, String>>);

impl WorkspaceState {
    pub fn new() -> Self {
        Self(Mutex::new(HashMap::new()))
    }
}

/// Opening a workspace is also what starts watching it, so the two can never
/// drift apart. Returns an error if the watcher could not be started -- on
/// Linux a large vault can exhaust the inotify watch limit, and the frontend
/// needs to know it is running without live updates rather than assume it is.
#[tauri::command]
#[specta::specta]
pub fn set_workspace(
    app: tauri::AppHandle,
    window: tauri::Window,
    state: tauri::State<WorkspaceState>,
    watchers: tauri::State<FsWatcherState>,
    path: String,
) -> Result<(), String> {
    let label = window.label().to_string();
    state.0.lock().unwrap().insert(label.clone(), path.clone());

    // Lets the webview load images and PDFs from this folder over `asset:`.
    // Granted per workspace rather than globally, so the page can only reach
    // what the user actually opened. Grants accumulate across switches within a
    // session, which is deliberate -- revoking would break `asset:` URLs in
    // tabs still open from the previous workspace.
    app.asset_protocol_scope().allow_directory(&path, true).map_err(|e| e.to_string())?;

    // Sync runs its own watcher, so it starts whatever the setting below says.
    crate::sync::workspace_opened(&app, &label, &path);

    watcher::watch_workspace(&app, &label, &path, &watchers)
}

#[tauri::command]
#[specta::specta]
pub fn get_workspace(window: tauri::Window, state: tauri::State<WorkspaceState>) -> Option<String> {
    state.0.lock().unwrap().get(window.label()).cloned()
}

/// Grants `asset:` access to one file outside the open workspace.
///
/// `set_workspace` only allows the workspace directory, so a file opened
/// through the file dialog from anywhere else resolves to a perfectly
/// well-formed `asset:` URL that the scope then denies -- a blank image or a
/// PDF that never loads, with nothing in the console to explain it. Viewers
/// call this before building the URL. Allowing a single file the user has
/// explicitly opened is the narrowest grant that fixes it.
#[tauri::command]
#[specta::specta]
pub fn allow_asset_path(app: tauri::AppHandle, path: String) -> Result<(), String> {
    app.asset_protocol_scope().allow_file(&path).map_err(|e| e.to_string())
}

/// Starts or stops watching the current workspace, backing the
/// `explorer.watchFilesystem` setting. Turning it off has to reach the OS
/// watcher itself -- muting the events on the frontend would leave the real
/// cost (a recursive watch over a network share or a very large vault) exactly
/// where it was.
#[tauri::command]
#[specta::specta]
pub fn set_watch_enabled(
    app: tauri::AppHandle,
    window: tauri::Window,
    state: tauri::State<WorkspaceState>,
    watchers: tauri::State<FsWatcherState>,
    enabled: bool,
) -> Result<(), String> {
    let label = window.label().to_string();

    if !enabled {
        watcher::unwatch(&label, &watchers);
        return Ok(());
    }

    let path = state.0.lock().unwrap().get(&label).cloned();

    match path {
        Some(path) => watcher::watch_workspace(&app, &label, &path, &watchers),
        None => Ok(()),
    }
}

/// Where new workspaces go unless the user picks somewhere else: Documents,
/// or home when there's no Documents folder.
#[tauri::command]
#[specta::specta]
pub fn default_workspace_parent(app: tauri::AppHandle) -> Option<String> {
    let paths = app.path();
    paths
        .document_dir()
        .or_else(|_| paths.home_dir())
        .ok()
        .map(|p| p.to_string_lossy().into_owned())
}

/// Makes the folder for a new workspace, `name` inside `parent`, and returns
/// its path. An empty folder of that name is fine (it may have been made by
/// hand for this); one with anything in it is refused, so a new workspace
/// never adopts someone else's files.
#[tauri::command]
#[specta::specta]
pub fn create_workspace(parent: String, name: String) -> Result<String, String> {
    create_workspace_in(Path::new(&parent), &name).map(|p| p.to_string_lossy().into_owned())
}

fn create_workspace_in(parent: &Path, name: &str) -> Result<PathBuf, String> {
    let name = check_workspace_name(name)?;
    if !parent.is_dir() {
        return Err(format!("{} isn't a folder.", parent.display()));
    }
    let path = parent.join(name);
    if path.exists() {
        let empty = std::fs::read_dir(&path)
            .map(|mut entries| entries.next().is_none())
            .unwrap_or(false);
        if !path.is_dir() || !empty {
            return Err(format!("{name} already exists there. Pick another name, or open it as a workspace."));
        }
        return Ok(path);
    }
    std::fs::create_dir(&path).map_err(|e| format!("Couldn't make {}: {e}", path.display()))?;
    Ok(path)
}

/// One visible folder name that every platform accepts.
fn check_workspace_name(name: &str) -> Result<&str, String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("Give the workspace a name.".into());
    }
    if name.starts_with('.') {
        return Err("A workspace name can't start with a dot.".into());
    }
    if name.ends_with('.') {
        return Err("A workspace name can't end with a dot.".into());
    }
    let forbidden = |c: &char| matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|') || c.is_control();
    if let Some(c) = name.chars().find(forbidden) {
        return Err(format!("A workspace name can't contain {c:?}."));
    }
    let stem = name.split('.').next().unwrap_or(name).to_ascii_uppercase();
    let reserved = matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || (stem.len() == 4
            && (stem.starts_with("COM") || stem.starts_with("LPT"))
            && stem.as_bytes()[3].is_ascii_digit());
    if reserved {
        return Err(format!("{name} is a name Windows keeps for itself."));
    }
    Ok(name)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn makes_the_folder() {
        let dir = tempfile::tempdir().unwrap();
        let path = create_workspace_in(dir.path(), "  Notes ").unwrap();
        assert_eq!(path, dir.path().join("Notes"));
        assert!(path.is_dir());
    }

    #[test]
    fn adopts_an_empty_folder_but_not_a_full_one() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir(dir.path().join("Empty")).unwrap();
        assert!(create_workspace_in(dir.path(), "Empty").is_ok());

        std::fs::create_dir(dir.path().join("Full")).unwrap();
        std::fs::write(dir.path().join("Full").join("a.md"), "x").unwrap();
        assert!(create_workspace_in(dir.path(), "Full").is_err());

        std::fs::write(dir.path().join("File"), "x").unwrap();
        assert!(create_workspace_in(dir.path(), "File").is_err());
    }

    #[test]
    fn refuses_bad_names() {
        let dir = tempfile::tempdir().unwrap();
        for name in ["", "  ", ".hidden", "a/b", "a\\b", "..", "x:y", "CON", "lpt1", "trailing."] {
            assert!(create_workspace_in(dir.path(), name).is_err(), "{name:?}");
        }
        assert!(create_workspace_in(dir.path(), "Console").is_ok());
        assert!(create_workspace_in(&dir.path().join("missing"), "Notes").is_err());
    }
}
