// src-tauri/src/watcher.rs
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use notify_debouncer_full::{
    new_debouncer,
    notify::{
        event::{ModifyKind, RenameMode},
        EventKind, RecommendedWatcher, RecursiveMode,
    },
    DebounceEventResult, DebouncedEvent, Debouncer, RecommendedCache,
};
use serde::{Deserialize, Serialize};
use specta::Type;
use tauri::{AppHandle, Manager};
use tauri_specta::Event;

use crate::types::FileEntry;

/// Long enough to collapse a truncate+write burst (which the OS reports as
/// several events) and to sit above the ~100ms FSEvents latency floor, short
/// enough that the sidebar still feels live.
const DEBOUNCE: Duration = Duration::from_millis(250);

/// How long a path we wrote ourselves stays suppressed. Covers one debounce
/// window plus slack, so a write is always still in the ledger by the time the
/// events it caused are flushed.
const SELF_WRITE_GRACE: Duration = Duration::from_millis(750);

type FsDebouncer = Debouncer<RecommendedWatcher, RecommendedCache>;
type Ledger = Arc<Mutex<HashMap<PathBuf, Instant>>>;

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub enum FsChangeKind {
    Created,
    Modified,
    Removed,
    Renamed,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct FsChange {
    pub kind: FsChangeKind,
    /// The path as it stands now. For `Renamed`, the destination.
    pub path: String,
    /// Only set for `Renamed`.
    pub from: Option<String>,
    /// Statted at emit time, so the frontend needs no follow-up call.
    /// `None` exactly when the path no longer exists.
    pub entry: Option<FileEntry>,
}

/// One debounced batch of changes under `root`.
#[derive(Debug, Clone, Serialize, Deserialize, Type, Event)]
pub struct FileSystemChanged {
    pub root: String,
    pub changes: Vec<FsChange>,
}

#[derive(Default)]
pub struct FsWatcherState {
    watchers: Mutex<HashMap<String, FsDebouncer>>,
    /// Paths this app wrote recently. Without it every autosave would look
    /// like an external edit and trigger a full round of index refreshes.
    ledger: Ledger,
}

impl FsWatcherState {
    pub fn new() -> Self {
        Self::default()
    }
}

fn lock<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    match mutex.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    }
}

/// Records a write we made ourselves, so the watcher can ignore the events it
/// is about to produce. Keyed by the path exactly as the frontend supplied it,
/// which is the namespace `to_frontend_path` maps events back into.
pub fn note_self_write(app: &AppHandle, path: &Path) {
    let state = app.state::<FsWatcherState>();
    lock(&state.ledger).insert(path.to_path_buf(), Instant::now());
}

/// Starts watching `root` for `label`, replacing any watcher already running
/// for that window.
pub fn watch_workspace(
    app: &AppHandle,
    label: &str,
    root: &str,
    state: &FsWatcherState,
) -> Result<(), String> {
    // Dropping a Debouncer joins its thread, so it must happen outside the
    // lock -- otherwise every other watcher operation blocks on that join.
    let previous = lock(&state.watchers).remove(label);
    drop(previous);

    let root_given = PathBuf::from(root);
    if !root_given.is_dir() {
        return Err(format!("{root} is not a directory"));
    }

    // FSEvents reports canonical paths, so a workspace reached through a
    // symlink -- or anything under /var, which is really /private/var -- comes
    // back under a prefix the frontend has never seen. Resolve it once here
    // rather than per event.
    let root_canonical = std::fs::canonicalize(&root_given).unwrap_or_else(|_| root_given.clone());

    let ledger = Arc::clone(&state.ledger);
    let app = app.clone();
    let given = root_given.clone();
    let canonical = root_canonical.clone();
    let root_label = root.to_string();

    let mut debouncer = new_debouncer(DEBOUNCE, None, move |result: DebounceEventResult| {
        match result {
            Ok(events) => {
                let changes = build_changes(&events, &given, &canonical, &ledger);
                if !changes.is_empty() {
                    let _ = (FileSystemChanged {
                        root: root_label.clone(),
                        changes,
                    })
                    .emit(&app);
                }
            }
            // A watch error is not fatal -- one unreadable subtree shouldn't
            // take the whole workspace's live updates down with it.
            Err(errors) => {
                for error in errors {
                    eprintln!("[watcher] {error:?}");
                }
            }
        }
    })
    .map_err(|e| e.to_string())?;

    debouncer
        .watch(&root_given, RecursiveMode::Recursive)
        .map_err(|e| e.to_string())?;

    lock(&state.watchers).insert(label.to_string(), debouncer);

    Ok(())
}

/// Stops watching for `label`. Safe to call when nothing is being watched.
pub fn unwatch(label: &str, state: &FsWatcherState) {
    let previous = lock(&state.watchers).remove(label);
    drop(previous);
}

/// Expires stale entries and returns what is still suppressed. Evaluated at
/// flush time rather than when an event arrives: on inotify the kernel event
/// can beat `note_self_write`, but never by a whole debounce window.
fn recent_self_writes(ledger: &Ledger) -> HashSet<PathBuf> {
    let mut guard = lock(ledger);
    let now = Instant::now();
    guard.retain(|_, at| now.duration_since(*at) < SELF_WRITE_GRACE);
    guard.keys().cloned().collect()
}

/// Rewrites a watcher-reported path into the namespace the frontend uses, or
/// `None` if it is outside the workspace or filtered as noise.
fn to_frontend_path(root_given: &Path, root_canonical: &Path, path: &Path) -> Option<String> {
    let relative = path
        .strip_prefix(root_canonical)
        .or_else(|_| path.strip_prefix(root_given))
        .ok()?;

    // The root itself carries nothing the frontend can act on.
    if relative.as_os_str().is_empty() || is_noise(relative) {
        return None;
    }

    Some(root_given.join(relative).to_string_lossy().into_owned())
}

fn is_noise(relative: &Path) -> bool {
    for component in relative.components() {
        let Some(name) = component.as_os_str().to_str() else {
            return true;
        };

        // Dot-directories hold tooling state, and `.solstice/` in particular is
        // rewritten on every settings change and every layout save -- without
        // this the app would trigger its own refreshes constantly.
        if name.starts_with('.') {
            return true;
        }
    }

    let Some(name) = relative.file_name().and_then(|n| n.to_str()) else {
        return true;
    };

    // Editor and OS scratch files that aren't dot-prefixed.
    name.ends_with(".swp")
        || name.ends_with(".swx")
        || name.ends_with(".tmp")
        || name.ends_with('~')
        || name == "4913"
}

fn describe(path: &str) -> Option<FileEntry> {
    let as_path = Path::new(path);
    let metadata = std::fs::symlink_metadata(as_path).ok()?;

    Some(FileEntry {
        name: as_path.file_name()?.to_string_lossy().into_owned(),
        path: path.to_string(),
        is_dir: metadata.is_dir(),
    })
}

fn build_changes(
    events: &[DebouncedEvent],
    root_given: &Path,
    root_canonical: &Path,
    ledger: &Ledger,
) -> Vec<FsChange> {
    let suppressed = recent_self_writes(ledger);
    let resolve = |p: &Path| to_frontend_path(root_given, root_canonical, p);

    // Keyed by path so a burst on one file collapses to its final state, with
    // insertion order tracked alongside so the frontend sees them in the order
    // they happened.
    let mut order: Vec<String> = Vec::new();
    let mut merged: HashMap<String, FsChange> = HashMap::new();

    for event in events {
        if event.paths.is_empty() {
            continue;
        }

        let stitched_rename = matches!(
            event.kind,
            EventKind::Modify(ModifyKind::Name(RenameMode::Both))
        ) && event.paths.len() >= 2;

        let (path, from) = if stitched_rename {
            match (resolve(&event.paths[1]), resolve(&event.paths[0])) {
                (Some(to), from) => (to, from),
                // Moved out of the workspace, or into a filtered directory:
                // from the app's point of view the source simply went away.
                (None, Some(from)) => (from, None),
                (None, None) => continue,
            }
        } else {
            match resolve(&event.paths[0]) {
                Some(path) => (path, None),
                None => continue,
            }
        };

        if suppressed.contains(Path::new(&path)) {
            continue;
        }

        // Ground truth beats the reported event kind: a create-then-delete
        // inside one window should read as a removal, and notify's own
        // classification of moves varies by platform.
        let entry = describe(&path);
        let kind = match (&entry, &from) {
            (Some(_), Some(_)) => FsChangeKind::Renamed,
            (Some(_), None) => match event.kind {
                EventKind::Create(_) | EventKind::Modify(ModifyKind::Name(_)) => {
                    FsChangeKind::Created
                }
                _ => FsChangeKind::Modified,
            },
            (None, _) => FsChangeKind::Removed,
        };

        // A rename whose destination is already gone is just a removal, and
        // reporting the destination path would retarget tabs onto nothing.
        let (path, from) = match (&kind, from) {
            (FsChangeKind::Removed, Some(from)) => (from, None),
            (_, from) => (path, from),
        };

        if !merged.contains_key(&path) {
            order.push(path.clone());
        }

        merged.insert(
            path.clone(),
            FsChange {
                kind,
                path,
                from,
                entry,
            },
        );
    }

    order
        .into_iter()
        .filter_map(|path| merged.remove(&path))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use notify_debouncer_full::notify::event::{CreateKind, Event, RemoveKind};

    fn event(kind: EventKind, paths: &[&Path]) -> DebouncedEvent {
        DebouncedEvent::new(
            Event {
                kind,
                paths: paths.iter().map(|p| p.to_path_buf()).collect(),
                attrs: Default::default(),
            },
            Instant::now(),
        )
    }

    fn temp_root(name: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!("solstice-watcher-{name}"));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        root
    }

    fn empty_ledger() -> Ledger {
        Arc::new(Mutex::new(HashMap::new()))
    }

    #[test]
    fn filters_dot_directories_and_scratch_files() {
        assert!(is_noise(Path::new(".solstice/settings.json")));
        assert!(is_noise(Path::new(".git/objects/ab/cdef")));
        assert!(is_noise(Path::new("notes/.hidden.md")));
        assert!(is_noise(Path::new("notes/.obsidian/workspace")));
        assert!(is_noise(Path::new("note.md.swp")));
        assert!(is_noise(Path::new("note.md~")));
        assert!(is_noise(Path::new("4913")));

        assert!(!is_noise(Path::new("note.md")));
        assert!(!is_noise(Path::new("notes/nested/deep.md")));
        // No extension filtering: the explorer shows every file.
        assert!(!is_noise(Path::new("notes/image.png")));
    }

    #[test]
    fn rewrites_canonical_paths_back_into_the_frontends_namespace() {
        let given = Path::new("/tmp/vault");
        let canonical = Path::new("/private/tmp/vault");

        assert_eq!(
            to_frontend_path(given, canonical, Path::new("/private/tmp/vault/note.md")),
            Some("/tmp/vault/note.md".to_string()),
        );
        // Already in the frontend's namespace (Linux/inotify).
        assert_eq!(
            to_frontend_path(given, canonical, Path::new("/tmp/vault/note.md")),
            Some("/tmp/vault/note.md".to_string()),
        );
        // The root itself, and anything outside the workspace, carry nothing
        // the frontend can act on.
        assert_eq!(to_frontend_path(given, canonical, given), None);
        assert_eq!(
            to_frontend_path(given, canonical, Path::new("/tmp/elsewhere/note.md")),
            None,
        );
    }

    #[test]
    fn classifies_by_ground_truth_not_by_reported_kind() {
        let root = temp_root("kinds");
        let present = root.join("present.md");
        std::fs::write(&present, "hi").unwrap();
        let absent = root.join("absent.md");

        let changes = build_changes(
            &[
                // Reported as a removal, but the file is on disk.
                event(EventKind::Remove(RemoveKind::File), &[&present]),
                // Reported as a creation, but the file is gone.
                event(EventKind::Create(CreateKind::File), &[&absent]),
            ],
            &root,
            &root,
            &empty_ledger(),
        );

        assert_eq!(changes.len(), 2);
        assert!(matches!(changes[0].kind, FsChangeKind::Modified));
        assert!(changes[0].entry.is_some());
        assert!(matches!(changes[1].kind, FsChangeKind::Removed));
        assert!(changes[1].entry.is_none());
    }

    #[test]
    fn stitches_renames_and_reports_directories() {
        let root = temp_root("rename");
        let from = root.join("old");
        let to = root.join("new");
        std::fs::create_dir_all(&to).unwrap();

        let changes = build_changes(
            &[event(
                EventKind::Modify(ModifyKind::Name(RenameMode::Both)),
                &[&from, &to],
            )],
            &root,
            &root,
            &empty_ledger(),
        );

        assert_eq!(changes.len(), 1);
        assert!(matches!(changes[0].kind, FsChangeKind::Renamed));
        assert_eq!(changes[0].from.as_deref(), Some(from.to_str().unwrap()));
        assert_eq!(changes[0].path, to.to_str().unwrap());
        assert!(changes[0].entry.as_ref().unwrap().is_dir);
    }

    #[test]
    fn a_rename_whose_destination_is_gone_reads_as_a_removal() {
        let root = temp_root("rename-gone");
        let from = root.join("old.md");
        let to = root.join("new.md");

        let changes = build_changes(
            &[event(
                EventKind::Modify(ModifyKind::Name(RenameMode::Both)),
                &[&from, &to],
            )],
            &root,
            &root,
            &empty_ledger(),
        );

        assert_eq!(changes.len(), 1);
        assert!(matches!(changes[0].kind, FsChangeKind::Removed));
        // The source is what the frontend has to act on -- reporting the
        // destination would retarget tabs onto a file that never appeared.
        assert_eq!(changes[0].path, from.to_str().unwrap());
        assert!(changes[0].from.is_none());
    }

    #[test]
    fn suppresses_our_own_writes_but_not_anyone_elses() {
        let root = temp_root("ledger");
        let ours = root.join("ours.md");
        let theirs = root.join("theirs.md");
        std::fs::write(&ours, "a").unwrap();
        std::fs::write(&theirs, "b").unwrap();

        let ledger = empty_ledger();
        ledger.lock().unwrap().insert(ours.clone(), Instant::now());

        let changes = build_changes(
            &[
                event(EventKind::Modify(ModifyKind::Any), &[&ours]),
                event(EventKind::Modify(ModifyKind::Any), &[&theirs]),
            ],
            &root,
            &root,
            &ledger,
        );

        assert_eq!(changes.len(), 1);
        assert_eq!(changes[0].path, theirs.to_str().unwrap());
    }

    #[test]
    fn expired_ledger_entries_stop_suppressing() {
        let root = temp_root("ledger-expiry");
        let path = root.join("note.md");
        std::fs::write(&path, "a").unwrap();

        let ledger = empty_ledger();
        ledger
            .lock()
            .unwrap()
            .insert(path.clone(), Instant::now() - SELF_WRITE_GRACE * 2);

        let changes = build_changes(
            &[event(EventKind::Modify(ModifyKind::Any), &[&path])],
            &root,
            &root,
            &ledger,
        );

        assert_eq!(changes.len(), 1);
        // ...and the stale entry is purged rather than accumulating.
        assert!(ledger.lock().unwrap().is_empty());
    }

    #[test]
    fn collapses_a_burst_on_one_path_to_its_final_state() {
        let root = temp_root("burst");
        let path = root.join("note.md");

        // create + modify + delete within one debounce window
        let changes = build_changes(
            &[
                event(EventKind::Create(CreateKind::File), &[&path]),
                event(EventKind::Modify(ModifyKind::Any), &[&path]),
                event(EventKind::Remove(RemoveKind::File), &[&path]),
            ],
            &root,
            &root,
            &empty_ledger(),
        );

        assert_eq!(changes.len(), 1);
        assert!(matches!(changes[0].kind, FsChangeKind::Removed));
    }
}
