// src-tauri/src/workspace.rs
use std::collections::HashMap;
use std::sync::Mutex;

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
