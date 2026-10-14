//! The iOS app's folder watcher: a walk of the workspace every couple of
//! seconds, compared with the last one.
//!
//! notify watches with kqueue on iOS, which holds a file descriptor open for
//! every file and folder it watches. iOS gives an app 256, so a vault of a
//! few hundred files (PDFs, and sync's copies of them) ran out: `os error 24`,
//! and then nothing could open a file or a socket. A walk only `stat`s.
//! Hidden paths (`.solstice/`, `.git`) aren't walked at all.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, SystemTime};

use super::{is_noise, FsChangeKind};

/// How often the folder is walked.
pub const INTERVAL: Duration = Duration::from_secs(2);

/// What a walk records of each path, enough to tell an edit.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Stamp {
    is_dir: bool,
    len: u64,
    modified: Option<SystemTime>,
}

pub type Snapshot = HashMap<PathBuf, Stamp>;

/// Everything under `root` but hidden paths, noise and symlinks.
pub fn snapshot(root: &Path) -> Snapshot {
    let mut out = Snapshot::new();
    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            let Ok(relative) = path.strip_prefix(root) else {
                continue;
            };
            if is_noise(relative) {
                continue;
            }
            let Ok(meta) = entry.metadata() else {
                continue;
            };
            if meta.is_symlink() {
                continue;
            }
            let stamp = Stamp {
                is_dir: meta.is_dir(),
                len: if meta.is_dir() { 0 } else { meta.len() },
                modified: meta.modified().ok(),
            };
            if stamp.is_dir {
                stack.push(path.clone());
            }
            out.insert(path, stamp);
        }
    }
    out
}

/// What changed from `before` to `after`, parents before children. A
/// folder's own timestamp changing isn't an edit (its entries are), and
/// whatever was inside a removed folder goes with it, unreported.
pub fn diff(before: &Snapshot, after: &Snapshot) -> Vec<(PathBuf, FsChangeKind)> {
    let mut changes = Vec::new();
    for (path, stamp) in after {
        match before.get(path) {
            None => changes.push((path.clone(), FsChangeKind::Created)),
            Some(old) if old.is_dir != stamp.is_dir => {
                changes.push((path.clone(), FsChangeKind::Created))
            }
            Some(old) if !stamp.is_dir && old != stamp => {
                changes.push((path.clone(), FsChangeKind::Modified))
            }
            Some(_) => {}
        }
    }
    let mut removed: Vec<&PathBuf> = before.keys().filter(|p| !after.contains_key(*p)).collect();
    removed.sort();
    let mut gone: Vec<&PathBuf> = Vec::new();
    for path in removed {
        if !gone.iter().any(|g| path.starts_with(g)) {
            changes.push((path.clone(), FsChangeKind::Removed));
            gone.push(path);
        }
    }
    changes.sort_by(|a, b| a.0.cmp(&b.0));
    changes
}

/// A running poll of one folder. Dropping it stops the walk.
pub struct Poller {
    shared: Arc<Shared>,
}

struct Shared {
    stop: AtomicBool,
    /// Whether the explorer hears of changes (`explorer.watchFilesystem`).
    /// Sync is told regardless.
    emit: AtomicBool,
    wake: Mutex<bool>,
    woken: Condvar,
}

impl Poller {
    /// Walks `root` every [`INTERVAL`] and calls `on_change` with what
    /// changed, and whether the explorer wants to hear of it.
    pub fn start(
        root: PathBuf,
        on_change: impl Fn(&[(PathBuf, FsChangeKind)], bool) + Send + 'static,
    ) -> Poller {
        let shared = Arc::new(Shared {
            stop: AtomicBool::new(false),
            emit: AtomicBool::new(true),
            wake: Mutex::new(false),
            woken: Condvar::new(),
        });
        let theirs = Arc::clone(&shared);
        // Taken here, so a change made straight after starting is seen.
        let mut last = snapshot(&root);
        std::thread::spawn(move || {
            let shared = theirs;
            loop {
                {
                    let woke = shared.wake.lock().unwrap_or_else(|p| p.into_inner());
                    let (mut woke, _) = shared
                        .woken
                        .wait_timeout_while(woke, INTERVAL, |w| !*w)
                        .unwrap_or_else(|p| p.into_inner());
                    *woke = false;
                }
                if shared.stop.load(Ordering::Relaxed) {
                    break;
                }
                let next = snapshot(&root);
                let changes = diff(&last, &next);
                last = next;
                if !changes.is_empty() {
                    on_change(&changes, shared.emit.load(Ordering::Relaxed));
                }
            }
        });
        Poller { shared }
    }

    /// Walks now rather than at the next interval (the app came back).
    pub fn poll_now(&self) {
        *self.shared.wake.lock().unwrap_or_else(|p| p.into_inner()) = true;
        self.shared.woken.notify_one();
    }

    pub fn set_emit(&self, emit: bool) {
        self.shared.emit.store(emit, Ordering::Relaxed);
    }
}

impl Drop for Poller {
    fn drop(&mut self) {
        self.shared.stop.store(true, Ordering::Relaxed);
        self.poll_now();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_root(name: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!("solstice-poll-{name}"));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        root
    }

    fn kinds(changes: &[(PathBuf, FsChangeKind)], root: &Path) -> Vec<(String, String)> {
        changes
            .iter()
            .map(|(p, k)| {
                (p.strip_prefix(root).unwrap().to_string_lossy().into_owned(), format!("{k:?}"))
            })
            .collect()
    }

    #[test]
    fn sees_creations_edits_and_removals_but_not_hidden_paths() {
        let root = temp_root("diff");
        std::fs::write(root.join("a.md"), "one").unwrap();
        std::fs::create_dir_all(root.join("folder/inner")).unwrap();
        std::fs::write(root.join("folder/inner/b.md"), "two").unwrap();
        let before = snapshot(&root);

        // Same length, same second: the length doesn't change, the time does.
        std::thread::sleep(Duration::from_millis(20));
        std::fs::write(root.join("a.md"), "uno").unwrap();
        std::fs::write(root.join("new.md"), "three").unwrap();
        std::fs::remove_dir_all(root.join("folder")).unwrap();
        std::fs::create_dir_all(root.join(".solstice/sync/blobs")).unwrap();
        std::fs::write(root.join(".solstice/sync/blobs/abc"), "cached").unwrap();
        std::fs::write(root.join("scratch.md.swp"), "noise").unwrap();

        let after = snapshot(&root);
        assert_eq!(
            kinds(&diff(&before, &after), &root),
            [
                ("a.md".into(), "Modified".into()),
                ("folder".into(), "Removed".into()),
                ("new.md".into(), "Created".into()),
            ]
        );
        assert!(diff(&after, &snapshot(&root)).is_empty());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn a_poller_reports_and_can_be_woken() {
        let root = temp_root("poller");
        let (tx, rx) = std::sync::mpsc::channel();
        let poller = Poller::start(root.clone(), move |changes, emit| {
            let _ = tx.send((changes.len(), emit));
        });
        std::fs::write(root.join("a.md"), "one").unwrap();
        poller.poll_now();
        assert_eq!(rx.recv_timeout(Duration::from_secs(5)).unwrap(), (1, true));

        poller.set_emit(false);
        std::fs::write(root.join("b.md"), "two").unwrap();
        poller.poll_now();
        assert_eq!(rx.recv_timeout(Duration::from_secs(5)).unwrap(), (1, false));
        drop(poller);
        let _ = std::fs::remove_dir_all(&root);
    }
}
