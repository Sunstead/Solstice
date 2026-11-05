//! Paths of files dropped on a window from outside (Finder, Explorer, a file
//! manager). The page gets HTML5 drops, which carry no paths, and Tauri's own
//! drop handler (`drag_drop_enabled`) would take every drag from the page,
//! the tab strip's and the tree's included. So each platform's webview is
//! watched for drops and the paths noted; the page's drop goes on as
//! before, and asks for them (`take_dropped_paths`) when it lands. Windows
//! has no watcher yet (WebView2 hands paths only to a page message with
//! the files), so there a drop only goes into a note.

use std::sync::Mutex;

#[cfg(target_os = "linux")]
mod linux;
#[cfg(target_os = "macos")]
mod macos;

/// The files of the last drop, until the page takes them. One drag at a
/// time, so one slot.
static DROPPED: Mutex<Vec<String>> = Mutex::new(Vec::new());

fn note(paths: Vec<String>) {
    *DROPPED.lock().unwrap() = paths;
}

/// The files the last drop on a window carried, once.
#[tauri::command]
#[specta::specta]
pub fn take_dropped_paths(app: tauri::AppHandle) -> Vec<String> {
    let paths = std::mem::take(&mut *DROPPED.lock().unwrap());
    for path in &paths {
        crate::open_files::grant(&app, std::path::Path::new(path));
    }
    paths
}

/// Starts watching a window's webview for drops.
#[allow(unused_variables)]
pub fn watch<R: tauri::Runtime>(window: &tauri::WebviewWindow<R>) {
    #[cfg(target_os = "macos")]
    macos::watch(window);
    #[cfg(target_os = "linux")]
    linux::watch(window);
}
