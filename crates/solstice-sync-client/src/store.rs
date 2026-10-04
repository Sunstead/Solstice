//! A linked folder's sync state: `<folder>/.solstice/sync/state.db`. Which
//! vault it's linked to, each document's Yjs state, the server snapshots
//! seen, attachments uploaded, and where files were written. All of it can
//! be rebuilt by linking again; the files are the truth.

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use solstice_sync::DocKey;
use solstice_sync_fs::Placed;

use crate::Error;

/// The private folder, relative to the linked folder.
pub const OWN: &str = ".solstice/sync";

const SCHEMA: &str = "
    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) WITHOUT ROWID;
    CREATE TABLE IF NOT EXISTS docs (doc TEXT PRIMARY KEY, epoch INTEGER NOT NULL, state BLOB NOT NULL) WITHOUT ROWID;
    CREATE TABLE IF NOT EXISTS seen (doc TEXT PRIMARY KEY, snapshot BLOB NOT NULL) WITHOUT ROWID;
    CREATE TABLE IF NOT EXISTS uploaded (hash TEXT PRIMARY KEY) WITHOUT ROWID;
";

/// Which vault a folder is linked to.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Link {
    /// The server's base URL, e.g. `https://solstice.jupiter.sunstead.net`.
    pub server: String,
    pub vault_id: String,
    pub vault_name: String,
    /// Shown on reviews this device records.
    pub device: String,
}

/// Everything to restore a client.
pub struct Saved {
    pub link: Link,
    pub docs: Vec<(String, u32, Vec<u8>)>,
    pub seen: Vec<(DocKey, Vec<u8>)>,
    pub uploaded: HashSet<String>,
    pub placed: Option<Placed>,
}

fn doc_name(key: &DocKey) -> String {
    match key {
        DocKey::Manifest => "manifest".into(),
        DocKey::Note(id) => format!("note:{id}"),
    }
}

fn doc_key(name: &str) -> Option<DocKey> {
    match name {
        "manifest" => Some(DocKey::Manifest),
        _ => name
            .strip_prefix("note:")
            .map(|id| DocKey::Note(id.to_string())),
    }
}

pub fn path(folder: &Path) -> PathBuf {
    OWN.split('/')
        .fold(folder.to_path_buf(), |p, s| p.join(s))
        .join("state.db")
}

/// True if `folder` is linked to a vault.
pub fn is_linked(folder: &Path) -> bool {
    path(folder).exists()
}

/// Which vault `folder` is linked to.
pub fn read_link(folder: &Path) -> Result<Link, Error> {
    Store::open(folder).map(|(_, saved)| saved.link)
}

#[derive(Clone)]
pub struct Store {
    conn: Arc<Mutex<Connection>>,
}

impl Store {
    fn open_at(file: &Path) -> Result<Self, Error> {
        if let Some(parent) = file.parent() {
            std::fs::create_dir_all(parent).map_err(Error::io)?;
        }
        let conn = Connection::open(file).map_err(Error::store)?;
        conn.execute_batch("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;")
            .and_then(|_| conn.execute_batch(SCHEMA))
            .map_err(Error::store)?;
        Ok(Self {
            conn: Arc::new(Mutex::new(conn)),
        })
    }

    /// A new store for a folder being linked.
    pub fn create(folder: &Path, link: &Link) -> Result<Self, Error> {
        let store = Self::open_at(&path(folder))?;
        let json = serde_json::to_string(link).expect("links serialize");
        store
            .with(|c| {
                c.execute(
                    "INSERT OR REPLACE INTO meta (key, value) VALUES ('link', ?1)",
                    [json],
                )
            })
            .map_err(Error::store)?;
        Ok(store)
    }

    /// The store of a linked folder, and what it holds.
    pub fn open(folder: &Path) -> Result<(Self, Saved), Error> {
        if !is_linked(folder) {
            return Err(Error::NotLinked);
        }
        let store = Self::open_at(&path(folder))?;
        let saved = store.with(|c| -> rusqlite::Result<_> {
            let meta = |key: &str| -> rusqlite::Result<Option<String>> {
                c.query_row("SELECT value FROM meta WHERE key = ?1", [key], |r| r.get(0))
                    .optional()
            };
            let link = meta("link")?;
            let placed = meta("placed")?;
            let mut docs = Vec::new();
            let mut stmt = c.prepare("SELECT doc, epoch, state FROM docs")?;
            for row in stmt.query_map([], |r| {
                Ok((r.get::<_, String>(0)?, r.get::<_, u32>(1)?, r.get(2)?))
            })? {
                docs.push(row?);
            }
            let mut seen = Vec::new();
            let mut stmt = c.prepare("SELECT doc, snapshot FROM seen")?;
            for row in stmt.query_map([], |r| {
                Ok((r.get::<_, String>(0)?, r.get::<_, Vec<u8>>(1)?))
            })? {
                let (doc, snapshot) = row?;
                if let Some(key) = doc_key(&doc) {
                    seen.push((key, snapshot));
                }
            }
            let mut uploaded = HashSet::new();
            let mut stmt = c.prepare("SELECT hash FROM uploaded")?;
            for row in stmt.query_map([], |r| r.get::<_, String>(0))? {
                uploaded.insert(row?);
            }
            Ok((link, placed, docs, seen, uploaded))
        });
        let (link, placed, docs, seen, uploaded) = saved.map_err(Error::store)?;
        let link: Link = link
            .and_then(|j| serde_json::from_str(&j).ok())
            .ok_or_else(|| Error::Store("the sync state has no link".into()))?;
        let placed = placed.and_then(|j| serde_json::from_str(&j).ok());
        Ok((
            store,
            Saved {
                link,
                docs,
                seen,
                uploaded,
                placed,
            },
        ))
    }

    fn with<T>(&self, f: impl FnOnce(&Connection) -> T) -> T {
        let conn = self.conn.lock().unwrap_or_else(|p| p.into_inner());
        f(&conn)
    }

    /// Saves changed documents (`(name, epoch, state)`, from [`doc_name`]),
    /// and the rest wholesale, in one transaction.
    pub fn save(
        &self,
        docs: Vec<(DocKey, u32, Vec<u8>)>,
        seen: Vec<(DocKey, Vec<u8>)>,
        uploaded: Vec<String>,
        placed: Option<&Placed>,
    ) -> Result<(), Error> {
        let placed = placed.map(|p| serde_json::to_string(p).expect("maps serialize"));
        let mut conn = self.conn.lock().unwrap_or_else(|p| p.into_inner());
        let tx = conn.transaction().map_err(Error::store)?;
        (|| -> rusqlite::Result<()> {
            for (key, epoch, state) in docs {
                tx.execute(
                    "INSERT OR REPLACE INTO docs (doc, epoch, state) VALUES (?1, ?2, ?3)",
                    params![doc_name(&key), epoch, state],
                )?;
            }
            for (key, snapshot) in seen {
                tx.execute(
                    "INSERT OR REPLACE INTO seen (doc, snapshot) VALUES (?1, ?2)",
                    params![doc_name(&key), snapshot],
                )?;
            }
            for hash in uploaded {
                tx.execute("INSERT OR IGNORE INTO uploaded (hash) VALUES (?1)", [hash])?;
            }
            if let Some(placed) = placed {
                tx.execute(
                    "INSERT OR REPLACE INTO meta (key, value) VALUES ('placed', ?1)",
                    [placed],
                )?;
            }
            Ok(())
        })()
        .map_err(Error::store)?;
        tx.commit().map_err(Error::store)
    }

    /// Forgets the link: the folder's files stay, its sync state goes.
    pub fn remove(folder: &Path) -> Result<(), Error> {
        let own = OWN.split('/').fold(folder.to_path_buf(), |p, s| p.join(s));
        for name in ["state.db", "state.db-wal", "state.db-shm", "blobs", "tmp"] {
            let p = own.join(name);
            let result = if p.is_dir() {
                std::fs::remove_dir_all(&p)
            } else {
                std::fs::remove_file(&p)
            };
            match result {
                Ok(()) => {}
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
                Err(e) => return Err(Error::io(e)),
            }
        }
        Ok(())
    }
}

pub(crate) fn key_from_name(name: &str) -> Option<DocKey> {
    doc_key(name)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn saves_and_restores() {
        let tmp = tempfile::tempdir().unwrap();
        let link = Link {
            server: "http://x".into(),
            vault_id: "v".into(),
            vault_name: "Notes".into(),
            device: "laptop".into(),
        };
        assert!(matches!(Store::open(tmp.path()), Err(Error::NotLinked)));
        let store = Store::create(tmp.path(), &link).unwrap();
        let mut placed = Placed::new();
        placed.insert("id".into(), ("a.md".into(), "hash".into()));
        store
            .save(
                vec![
                    (DocKey::Manifest, 3, vec![1]),
                    (DocKey::Note("n".into()), 0, vec![2]),
                ],
                vec![(DocKey::Manifest, vec![9])],
                vec!["h1".into()],
                Some(&placed),
            )
            .unwrap();
        drop(store);
        assert!(is_linked(tmp.path()));
        let (_, saved) = Store::open(tmp.path()).unwrap();
        assert_eq!(saved.link, link);
        assert_eq!(saved.docs.len(), 2);
        assert_eq!(saved.seen, vec![(DocKey::Manifest, vec![9])]);
        assert!(saved.uploaded.contains("h1"));
        assert_eq!(saved.placed, Some(placed));
    }
}
