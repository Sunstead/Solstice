//! Full-text search of a workspace (`solstice-search`): one index per root,
//! cached in `.solstice/search/`, refreshed by what changed before each query.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use solstice_search::{Index, Limits, Query, Results};

/// The cache is written at most this often while queries keep changing it.
const SAVE_EVERY: Duration = Duration::from_secs(5);

struct Slot {
    index: Index,
    saved: Option<Instant>,
}

#[derive(Default)]
pub struct SearchState {
    slots: Mutex<HashMap<String, Arc<Mutex<Slot>>>>,
}

impl SearchState {
    fn slot(&self, root: &str) -> Arc<Mutex<Slot>> {
        let mut slots = self.slots.lock().unwrap_or_else(|e| e.into_inner());
        slots
            .entry(root.to_owned())
            .or_insert_with(|| {
                let cache = Path::new(root).join(".solstice").join("search").join("index.json.gz");
                Arc::new(Mutex::new(Slot {
                    index: Index::open(PathBuf::from(root), Some(cache)),
                    saved: None,
                }))
            })
            .clone()
    }
}

/// Brings `root`'s index up to date, then runs `then` on it.
fn with_fresh<T>(slot: &Mutex<Slot>, excludes: &[String], force_save: bool, then: impl FnOnce(&Index) -> T) -> T {
    let mut slot = slot.lock().unwrap_or_else(|e| e.into_inner());
    slot.index.set_excludes(excludes);
    // A folder that can't be read now still has what was read before.
    if let Err(e) = slot.index.refresh() {
        log::warn!("[search] can't read the workspace: {e}");
    }
    if force_save || slot.saved.is_none_or(|t| t.elapsed() >= SAVE_EVERY) {
        if let Err(e) = slot.index.save() {
            log::warn!("[search] can't write the cache: {e}");
        }
        slot.saved = Some(Instant::now());
    }
    then(&slot.index)
}

/// Joins a relative path from the index (`/` between parts) onto `root`.
fn absolute(root: &str, rel: &str) -> String {
    rel.split('/').fold(PathBuf::from(root), |path, part| path.join(part)).to_string_lossy().into_owned()
}

/// `query` in every file of the workspace at `root`, leaving out dot-folders
/// and `excludes` (folder names, or paths from the root).
#[tauri::command]
#[specta::specta]
pub async fn search_workspace(
    state: tauri::State<'_, SearchState>,
    root: String,
    query: Query,
    excludes: Vec<String>,
) -> Result<Results, String> {
    let slot = state.slot(&root);
    tokio::task::spawn_blocking(move || {
        let mut results = with_fresh(&slot, &excludes, false, |index| index.search(&query, Limits::default()));
        for file in &mut results.files {
            file.path = absolute(&root, &file.path);
        }
        results
    })
    .await
    .map_err(|e| e.to_string())
}

/// Reads the workspace into its index ahead of the first query.
#[tauri::command]
#[specta::specta]
pub async fn warm_search_index(
    state: tauri::State<'_, SearchState>,
    root: String,
    excludes: Vec<String>,
) -> Result<(), String> {
    let slot = state.slot(&root);
    tokio::task::spawn_blocking(move || with_fresh(&slot, &excludes, true, |_| ()))
        .await
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn joins_relative_paths_onto_the_root() {
        let joined = absolute("/ws", "Biology/Cells.md");
        assert_eq!(PathBuf::from(joined), Path::new("/ws").join("Biology").join("Cells.md"));
    }
}
