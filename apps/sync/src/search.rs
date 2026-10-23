//! The web app's full-text search: a `solstice-search` index per vault over
//! its folder, refreshed by what changed before each query, its cache under
//! the state dir (never in the vault's folder, which the hub watches and
//! syncs). An index unused for a while is let go.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use solstice_search::{Index, Limits, Query, Results};

/// An index unused this long is dropped (its cache stays).
const IDLE: Duration = Duration::from_secs(30 * 60);
/// The cache is written at most this often while queries keep changing it.
const SAVE_EVERY: Duration = Duration::from_secs(5);

struct Slot {
    index: Index,
    used: Instant,
    saved: Option<Instant>,
}

#[derive(Clone)]
pub struct Searches {
    cache_dir: PathBuf,
    slots: Arc<Mutex<HashMap<String, Arc<Mutex<Slot>>>>>,
}

impl Searches {
    pub fn new(cache_dir: PathBuf) -> Self {
        Self {
            cache_dir,
            slots: Arc::default(),
        }
    }

    /// `query` in the vault `id`, whose files are in `folder`; paths relative
    /// to it. Blocks: run it off the async threads.
    pub fn search(&self, id: &str, folder: PathBuf, query: &Query, excludes: &[String]) -> Results {
        let slot = {
            let mut slots = self.slots.lock().unwrap_or_else(|e| e.into_inner());
            slots.retain(|key, slot| {
                key == id || slot.try_lock().map_or(true, |s| s.used.elapsed() < IDLE)
            });
            slots
                .entry(id.to_owned())
                .or_insert_with(|| {
                    let cache = self.cache_dir.join(format!("{id}.json.gz"));
                    Arc::new(Mutex::new(Slot {
                        index: Index::open(folder, Some(cache)),
                        used: Instant::now(),
                        saved: None,
                    }))
                })
                .clone()
        };
        let mut slot = slot.lock().unwrap_or_else(|e| e.into_inner());
        slot.used = Instant::now();
        slot.index.set_excludes(excludes);
        if let Err(e) = slot.index.refresh() {
            tracing::warn!(vault = id, "search can't read the folder: {e}");
        }
        if slot.saved.is_none_or(|t| t.elapsed() >= SAVE_EVERY) {
            if let Err(e) = slot.index.save() {
                tracing::warn!(vault = id, "search can't write its cache: {e}");
            }
            slot.saved = Some(Instant::now());
        }
        slot.index.search(query, Limits::default())
    }
}
