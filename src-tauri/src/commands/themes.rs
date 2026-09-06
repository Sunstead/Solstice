use std::{ fs, path::PathBuf };

use serde::{ Deserialize, Serialize };
use specta::Type;
use tauri::Manager;

use crate::workspace::WorkspaceState;

/// One theme file as found on disk. The contents are handed over unparsed:
/// validating here would split the rules across two languages, and the
/// frontend already owns the token allowlist that decides what a theme may
/// declare.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct UserThemeFile {
    pub path: String,
    /// `"workspace"` or `"global"`, for the badge on the theme card.
    pub source: String,
    pub contents: String,
}

fn read_theme_dir(dir: PathBuf, source: &str, out: &mut Vec<UserThemeFile>) {
    // A missing directory is the normal case -- most workspaces have no themes
    // of their own -- so it is not an error, just nothing to add.
    let Ok(entries) = fs::read_dir(&dir) else {
        return;
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        match fs::read_to_string(&path) {
            Ok(contents) =>
                out.push(UserThemeFile {
                    path: path.to_string_lossy().into_owned(),
                    source: source.to_string(),
                    contents,
                }),
            // One unreadable file should not hide the rest of the folder.
            Err(error) => eprintln!("Failed to read theme {}: {error}", path.display()),
        }
    }
}

/// Every user-authored theme visible right now: the ones in the open workspace
/// and the ones in the app data dir, which follow the user between workspaces.
#[tauri::command]
#[specta::specta]
pub fn list_user_themes(
    app: tauri::AppHandle,
    window: tauri::Window,
    state: tauri::State<WorkspaceState>
) -> Result<Vec<UserThemeFile>, String> {
    let mut themes = Vec::new();

    if let Ok(dir) = app.path().app_data_dir() {
        read_theme_dir(dir.join("themes"), "global", &mut themes);
    }

    let workspace = state.0.lock().unwrap().get(window.label()).cloned();
    if let Some(workspace) = workspace {
        read_theme_dir(PathBuf::from(workspace).join(".solstice/themes"), "workspace", &mut themes);
    }

    Ok(themes)
}

/// The directory a user theme should be dropped into, created on demand so the
/// settings pane can offer to reveal it.
#[tauri::command]
#[specta::specta]
pub fn ensure_theme_dir(
    app: tauri::AppHandle,
    window: tauri::Window,
    state: tauri::State<WorkspaceState>,
    scope: String
) -> Result<String, String> {
    let dir = if scope == "workspace" {
        let workspace = state.0
            .lock()
            .unwrap()
            .get(window.label())
            .cloned()
            .ok_or("No workspace is open")?;
        PathBuf::from(workspace).join(".solstice/themes")
    } else {
        app.path().app_data_dir().map_err(|e| e.to_string())?.join("themes")
    };

    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.to_string_lossy().into_owned())
}
