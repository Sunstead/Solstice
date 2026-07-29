// src-tauri/src/workspace.rs
use std::collections::HashMap;
use std::sync::Mutex;

pub struct WorkspaceState(pub Mutex<HashMap<String, String>>);

impl WorkspaceState {
    pub fn new() -> Self {
        Self(Mutex::new(HashMap::new()))
    }
}

#[tauri::command]
pub fn set_workspace(window: tauri::Window, state: tauri::State<WorkspaceState>, path: String) {
    state.0.lock().unwrap().insert(window.label().to_string(), path);
}

#[tauri::command]
pub fn get_workspace(window: tauri::Window, state: tauri::State<WorkspaceState>) -> Option<String> {
    state.0.lock().unwrap().get(window.label()).cloned()
}
