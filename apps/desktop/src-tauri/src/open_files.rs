//! Files the OS asks the app to open, from outside any workspace: a double
//! click in Finder or Explorer, Open With, a path on the command line, or a
//! drop on a window. Each goes to the window whose workspace holds it, else
//! the window in front, else a new one; that window's page takes them from
//! a queue (`take_pending_opens`), told to look by `OpenFilesQueued`, so a
//! window still loading misses none.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use specta::Type;
use tauri::{AppHandle, Manager};
use tauri_specta::Event;

use crate::windows::{self, WindowEntry, WindowKind};

/// Files waiting for each window's page, by label.
#[derive(Default)]
pub struct PendingOpens(Mutex<HashMap<String, Vec<String>>>);

impl PendingOpens {
    pub fn push(&self, label: &str, paths: impl IntoIterator<Item = String>) {
        let mut queue = self.0.lock().unwrap();
        let waiting = queue.entry(label.to_string()).or_default();
        for path in paths {
            if !waiting.contains(&path) {
                waiting.push(path);
            }
        }
    }

    pub fn take(&self, label: &str) -> Vec<String> {
        self.0.lock().unwrap().remove(label).unwrap_or_default()
    }
}

/// Files are waiting for this window: `take_pending_opens`.
#[derive(Debug, Clone, Serialize, Deserialize, Type, tauri_specta::Event)]
pub struct OpenFilesQueued;

/// Hands each file to its window (see the module's doc) and brings that
/// window forward.
pub fn route(app: &AppHandle, paths: Vec<PathBuf>) {
    if paths.is_empty() {
        return;
    }
    let known = windows::session_windows(app);
    let mut by_window: HashMap<String, Vec<String>> = HashMap::new();
    for path in paths {
        let label = match owning_window(&path, &known) {
            Some(label) => label.to_string(),
            None => match windows::current(app) {
                Some(window) => window.label().to_string(),
                None => match windows::open_empty(app) {
                    Ok(label) => label,
                    Err(e) => {
                        log::error!("couldn't open a window for {}: {e}", path.display());
                        continue;
                    }
                },
            },
        };
        grant(app, &path);
        by_window.entry(label).or_default().push(path.to_string_lossy().into_owned());
    }
    let pending = app.state::<PendingOpens>();
    for (label, paths) in by_window {
        log::info!("window {label}: opening {} file(s) from outside", paths.len());
        pending.push(&label, paths);
        OpenFilesQueued.emit_to(app, &label).ok();
        windows::focus(app, &label);
    }
}

/// What a file from outside shows needs the asset protocol: the file (an
/// image, a PDF), and a note's own folder, where its images are.
pub fn grant<R: tauri::Runtime>(app: &tauri::AppHandle<R>, path: &Path) {
    let scope = app.asset_protocol_scope();
    let _ = scope.allow_file(path);
    let note = path.extension().is_some_and(|e| e.eq_ignore_ascii_case("md") || e.eq_ignore_ascii_case("markdown"));
    if let (true, Some(folder)) = (note, path.parent()) {
        let _ = scope.allow_directory(folder, true);
    }
}

/// `solstice://` links, to the window in front only (the plugin's own event
/// reaches every window, and each would open the link), through the same
/// queue as files; the page tells them apart by their scheme.
/// Only the app's own links: on macOS the plugin also hears Finder's
/// `file://` opens, which `RunEvent::Opened` routes as files.
pub fn solstice_links(urls: Vec<String>) -> Vec<String> {
    urls.into_iter().filter(|url| url.starts_with("solstice:")).collect()
}

pub fn route_links(app: &AppHandle, urls: Vec<String>) {
    let urls = solstice_links(urls);
    if urls.is_empty() {
        return;
    }
    let Some(window) = windows::current(app) else { return };
    let label = window.label().to_string();
    app.state::<PendingOpens>().push(&label, urls);
    OpenFilesQueued.emit_to(app, &label).ok();
    windows::focus(app, &label);
}

/// `grant`, for a tab from outside the workspace a layout brings back (a
/// relaunch), which never came through `route`.
#[tauri::command]
#[specta::specta]
pub fn allow_outside_file(app: AppHandle, path: String) {
    grant(&app, Path::new(&path));
}

/// The files (and links) waiting for this window, once.
#[tauri::command]
#[specta::specta]
pub fn take_pending_opens(window: tauri::Window, pending: tauri::State<PendingOpens>) -> Vec<String> {
    pending.take(window.label())
}

/// The files among a launch's arguments: not the program, flags or links
/// (`solstice://` goes to the deep-link plugin), relative ones taken from
/// where it was launched, and only those that exist.
pub fn paths_from_args(args: &[String], cwd: &Path) -> Vec<PathBuf> {
    args.iter()
        .skip(1)
        .filter(|arg| !arg.starts_with('-') && !arg.contains("://"))
        .map(|arg| cwd.join(arg))
        .filter(|path| path.is_file())
        .collect()
}

/// The full window whose workspace holds `path`: the deepest, when one
/// workspace is inside another.
pub fn owning_window<'a>(path: &Path, windows: &'a [WindowEntry]) -> Option<&'a str> {
    windows
        .iter()
        .filter(|w| w.kind == WindowKind::Full)
        .filter_map(|w| Some((w, Path::new(w.workspace.as_deref()?))))
        // By whole components, so `/a/bc` isn't in `/a/b`.
        .filter(|(_, root)| path.starts_with(root))
        .max_by_key(|(_, root)| root.components().count())
        .map(|(w, _)| w.label.as_str())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn full(label: &str, workspace: &str) -> WindowEntry {
        WindowEntry { label: label.into(), kind: WindowKind::Full, workspace: Some(workspace.into()), bounds: None }
    }

    #[test]
    fn keeps_existing_files_and_resolves_relative_ones() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("a.md"), "").unwrap();
        std::fs::create_dir(dir.path().join("sub")).unwrap();
        std::fs::write(dir.path().join("sub/b.md"), "").unwrap();
        let abs = dir.path().join("a.md").to_string_lossy().to_string();
        let args: Vec<String> = ["solstice", &abs, "sub/b.md", "missing.md", "--flag", "-psn_0_1", "solstice://open?vault=x&path=y", "sub"]
            .iter()
            .map(|s| s.to_string())
            .collect();
        assert_eq!(paths_from_args(&args, dir.path()), vec![dir.path().join("a.md"), dir.path().join("sub/b.md")]);
    }

    #[test]
    fn has_no_files_without_arguments() {
        assert!(paths_from_args(&["solstice".into()], Path::new("/")).is_empty());
        assert!(paths_from_args(&[], Path::new("/")).is_empty());
    }

    #[test]
    fn finds_the_window_whose_workspace_holds_a_file() {
        let windows = vec![full("main", "/notes"), full("w-1", "/notes/work")];
        assert_eq!(owning_window(Path::new("/notes/a.md"), &windows), Some("main"));
        // A workspace inside another: the deeper one has it.
        assert_eq!(owning_window(Path::new("/notes/work/b.md"), &windows), Some("w-1"));
        assert_eq!(owning_window(Path::new("/elsewhere/c.md"), &windows), None);
    }

    #[test]
    fn matches_whole_folder_names_only() {
        let windows = vec![full("main", "/a/b")];
        assert_eq!(owning_window(Path::new("/a/bc/x.md"), &windows), None);
        assert_eq!(owning_window(Path::new("/a/b/x.md"), &windows), Some("main"));
    }

    #[test]
    fn leaves_out_editor_windows_and_empty_ones() {
        let windows = vec![
            WindowEntry {
                label: "w-2".into(),
                kind: WindowKind::Editor { parent: "main".into() },
                workspace: Some("/notes".into()),
                bounds: None,
            },
            WindowEntry { label: "w-3".into(), kind: WindowKind::Full, workspace: None, bounds: None },
        ];
        assert_eq!(owning_window(Path::new("/notes/a.md"), &windows), None);
    }

    #[test]
    fn keeps_only_solstice_links() {
        // On macOS the deep-link plugin also hears Finder's `file://` opens,
        // which `RunEvent::Opened` already routes as files.
        let urls = vec!["solstice://open?vault=a&path=b".to_string(), "file:///tmp/a.md".to_string(), "https://x".to_string()];
        assert_eq!(solstice_links(urls), vec!["solstice://open?vault=a&path=b"]);
    }

    #[test]
    fn queues_each_file_once_and_hands_them_over_once() {
        let pending = PendingOpens::default();
        pending.push("main", ["/a.md".to_string(), "/b.md".to_string()]);
        pending.push("main", ["/a.md".to_string()]);
        assert_eq!(pending.take("main"), vec!["/a.md", "/b.md"]);
        assert!(pending.take("main").is_empty());
        assert!(pending.take("w-1").is_empty());
    }
}
