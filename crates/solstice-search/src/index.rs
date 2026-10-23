//! A folder's docs, kept up to date.

use std::collections::{BTreeMap, HashMap};
use std::fs;
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use serde::{Deserialize, Serialize};

use crate::extract::{extract, kind_of, Doc};
use crate::query::{search, Limits, Query, Results};

/// Bumped when what's cached changes shape or meaning: an older cache is
/// then read as none.
const CACHE_VERSION: u32 = 1;

/// Past this a file isn't read: one huge PDF shouldn't hold up every search.
const MAX_FILE: u64 = 64 << 20;

/// What a refresh did.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct RefreshStats {
    /// Files searched.
    pub files: usize,
    /// Files read again.
    pub extracted: usize,
    /// Files gone.
    pub removed: usize,
}

#[derive(Serialize, Deserialize)]
struct Entry {
    size: u64,
    /// Nanoseconds since the epoch.
    modified: u64,
    doc: Doc,
}

#[derive(Serialize, Deserialize)]
struct Cache {
    version: u32,
    entries: BTreeMap<String, Entry>,
}

/// The searchable text of every file under a folder, by relative path.
pub struct Index {
    root: PathBuf,
    cache: Option<PathBuf>,
    /// Folder names left out wherever they are.
    excluded_names: Vec<String>,
    /// Relative folder paths left out.
    excluded_paths: Vec<String>,
    entries: BTreeMap<String, Entry>,
    /// Changed since the cache was written.
    dirty: bool,
}

impl Index {
    /// An index of `root`, warmed from `cache` (a file) if one is there.
    pub fn open(root: PathBuf, cache: Option<PathBuf>) -> Self {
        let entries = cache.as_deref().and_then(read_cache).unwrap_or_default();
        Self {
            root,
            cache,
            excluded_names: Vec::new(),
            excluded_paths: Vec::new(),
            entries,
            dirty: false,
        }
    }

    /// Folders left out besides dot-folders: a name leaves out every folder
    /// so named, a path (with a `/`) that one folder, from the root.
    pub fn set_excludes(&mut self, excludes: &[String]) {
        self.excluded_names.clear();
        self.excluded_paths.clear();
        for exclude in excludes {
            let exclude = exclude.trim().trim_matches('/');
            if exclude.is_empty() {
                continue;
            }
            if exclude.contains('/') {
                self.excluded_paths.push(exclude.to_owned());
            } else {
                self.excluded_names.push(exclude.to_owned());
            }
        }
        let before = self.entries.len();
        let excluded: Vec<String> = self.entries.keys().filter(|p| self.excluded(p)).cloned().collect();
        for path in excluded {
            self.entries.remove(&path);
        }
        self.dirty |= self.entries.len() != before;
    }

    /// Whether a relative path is in an excluded folder.
    fn excluded(&self, path: &str) -> bool {
        let mut parts: Vec<&str> = path.split('/').collect();
        parts.pop();
        parts.iter().any(|part| self.excluded_names.iter().any(|n| n == part))
            || self
                .excluded_paths
                .iter()
                .any(|p| path.strip_prefix(p.as_str()).is_some_and(|rest| rest.starts_with('/')))
    }

    /// Brings the index up to date with the folder: reads again each file
    /// whose size or modification time changed, and forgets those gone. A
    /// root that can't be read is an error, and the index keeps what it had;
    /// so does a folder inside it, for what was under it.
    pub fn refresh(&mut self) -> io::Result<RefreshStats> {
        let mut seen = HashMap::new();
        let mut unreadable = Vec::new();
        fs::read_dir(&self.root)?;
        self.walk(&self.root.clone(), "", &mut seen, &mut unreadable);

        let mut stats = RefreshStats { files: seen.len(), ..RefreshStats::default() };
        let gone: Vec<String> = self
            .entries
            .keys()
            .filter(|p| !seen.contains_key(*p) && !unreadable.iter().any(|u: &String| under(p, u)))
            .cloned()
            .collect();
        for path in gone {
            self.entries.remove(&path);
            stats.removed += 1;
        }

        for (path, (size, modified)) in seen {
            let fresh = self.entries.get(&path).is_some_and(|e| e.size == size && e.modified == modified);
            if fresh {
                continue;
            }
            let Some(kind) = kind_of(&path) else { continue };
            let doc = if size > MAX_FILE {
                Doc { kind, segments: Vec::new() }
            } else {
                match fs::read(self.root.join(&path)) {
                    Ok(bytes) => extract(kind, &bytes),
                    // Gone or locked since the walk: tried again next time.
                    Err(_) => continue,
                }
            };
            self.entries.insert(path, Entry { size, modified, doc });
            stats.extracted += 1;
        }
        self.dirty |= stats.extracted > 0 || stats.removed > 0;
        Ok(stats)
    }

    fn walk(&self, dir: &Path, rel: &str, seen: &mut HashMap<String, (u64, u64)>, unreadable: &mut Vec<String>) {
        let Ok(read) = fs::read_dir(dir) else {
            unreadable.push(rel.to_owned());
            return;
        };
        for entry in read.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            if name.starts_with('.') {
                continue;
            }
            let path = if rel.is_empty() { name.clone() } else { format!("{rel}/{name}") };
            let Ok(meta) = entry.metadata() else { continue };
            if meta.is_dir() {
                let child = format!("{path}/");
                if !self.excluded(&child) {
                    self.walk(&entry.path(), &path, seen, unreadable);
                }
            } else if meta.is_file() && kind_of(&name).is_some() {
                let modified = meta
                    .modified()
                    .ok()
                    .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                    .map_or(0, |d| d.as_nanos() as u64);
                seen.insert(path, (meta.len(), modified));
            }
        }
    }

    /// `query` in every file; paths relative to the root, `/` between parts.
    pub fn search(&self, query: &Query, limits: Limits) -> Results {
        search(self.entries.iter().map(|(p, e)| (p.as_str(), &e.doc)), query, limits)
    }

    /// Writes the cache if anything changed since it was last written:
    /// through a temporary file, so a crash never leaves half of one.
    pub fn save(&mut self) -> io::Result<()> {
        let Some(path) = self.cache.as_deref().filter(|_| self.dirty) else {
            return Ok(());
        };
        if let Some(dir) = path.parent() {
            fs::create_dir_all(dir)?;
        }
        let entries = std::mem::take(&mut self.entries);
        let cache = Cache { version: CACHE_VERSION, entries };
        let written = write_cache(path, &cache);
        self.entries = cache.entries;
        written?;
        self.dirty = false;
        Ok(())
    }
}

/// Whether `path` is under the folder `dir` (`""` is the root).
fn under(path: &str, dir: &str) -> bool {
    dir.is_empty() || path.strip_prefix(dir).is_some_and(|rest| rest.starts_with('/'))
}

fn read_cache(path: &Path) -> Option<BTreeMap<String, Entry>> {
    let mut json = Vec::new();
    flate2::read::GzDecoder::new(fs::File::open(path).ok()?).read_to_end(&mut json).ok()?;
    let cache: Cache = serde_json::from_slice(&json).ok()?;
    (cache.version == CACHE_VERSION).then_some(cache.entries)
}

fn write_cache(path: &Path, cache: &Cache) -> io::Result<()> {
    let temp = path.with_extension("tmp");
    let mut encoder = flate2::write::GzEncoder::new(fs::File::create(&temp)?, flate2::Compression::fast());
    serde_json::to_writer(&mut encoder, cache)?;
    encoder.finish()?.flush()?;
    fs::rename(&temp, path)
}
