//! A vault's folder on the server: plain files, the truth Atlas and backups
//! read. The sync state is written out here as files change, and edits made
//! here directly (by hand, by a script) are read back in as sync changes.
//!
//! `.solstice/` inside the folder is the server's own: `blobs/` caches
//! attachments by hash, `trash/` keeps files deleted through sync.

use std::collections::{BTreeMap, HashMap};
use std::path::{Path, PathBuf};
use std::time::SystemTime;

use solstice_sync::{content_hash, Content, FileId, Kind, Msg, Vault};

const OWN: &str = ".solstice";

/// One file as found on disk.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Found {
    pub hash: String,
    pub size: u64,
    pub modified: Option<SystemTime>,
}

pub struct VaultDir {
    root: PathBuf,
    /// Hashes by path, reused while size and mtime are unchanged.
    seen: HashMap<String, Found>,
    /// Where each file was last written, by id: `(path, hash)`.
    placed: HashMap<FileId, (String, String)>,
}

fn rel_path(root: &Path, path: &Path) -> Option<String> {
    let rel = path.strip_prefix(root).ok()?;
    let parts: Vec<&str> = rel.iter().map(|c| c.to_str()).collect::<Option<_>>()?;
    Some(parts.join("/"))
}

fn hidden(rel: &str) -> bool {
    rel.split('/').any(|s| s.starts_with('.'))
}

impl VaultDir {
    pub fn open(root: PathBuf) -> std::io::Result<Self> {
        std::fs::create_dir_all(&root)?;
        Ok(Self {
            root,
            seen: HashMap::new(),
            placed: HashMap::new(),
        })
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    fn abs(&self, rel: &str) -> PathBuf {
        rel.split('/').fold(self.root.clone(), |p, s| p.join(s))
    }

    /// Every file that syncs (hidden ones never do), hashed. Symlinks are
    /// skipped: nothing outside the folder gets in.
    pub fn scan(&mut self) -> std::io::Result<BTreeMap<String, Found>> {
        let mut out = BTreeMap::new();
        let mut stack = vec![self.root.clone()];
        while let Some(dir) = stack.pop() {
            for entry in std::fs::read_dir(&dir)? {
                let entry = entry?;
                let path = entry.path();
                let Some(rel) = rel_path(&self.root, &path) else {
                    continue;
                };
                if hidden(&rel) {
                    continue;
                }
                let meta = entry.metadata()?;
                if meta.is_symlink() {
                    continue;
                } else if meta.is_dir() {
                    stack.push(path);
                } else if meta.is_file() {
                    let modified = meta.modified().ok();
                    let found = match self.seen.get(&rel) {
                        Some(f) if f.size == meta.len() && f.modified == modified => f.clone(),
                        _ => Found {
                            hash: content_hash(&std::fs::read(&path)?),
                            size: meta.len(),
                            modified,
                        },
                    };
                    self.seen.insert(rel.clone(), found.clone());
                    out.insert(rel, found);
                }
            }
        }
        self.seen.retain(|k, _| out.contains_key(k));
        Ok(out)
    }

    pub fn read(&self, rel: &str) -> std::io::Result<Vec<u8>> {
        std::fs::read(self.abs(rel))
    }

    /// Writes through a temporary file, so readers never see half a file.
    fn write(&mut self, rel: &str, bytes: &[u8]) -> std::io::Result<()> {
        let path = self.abs(rel);
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let tmp = self.root.join(OWN).join("tmp");
        std::fs::create_dir_all(&tmp)?;
        let tmp = tmp.join(uuid::Uuid::new_v4().to_string());
        std::fs::write(&tmp, bytes)?;
        std::fs::rename(&tmp, &path)?;
        self.note_written(rel, bytes);
        Ok(())
    }

    fn note_written(&mut self, rel: &str, bytes: &[u8]) {
        if let Ok(meta) = std::fs::metadata(self.abs(rel)) {
            let found = Found {
                hash: content_hash(bytes),
                size: meta.len(),
                modified: meta.modified().ok(),
            };
            self.seen.insert(rel.to_string(), found);
        }
    }

    /// Moves a file into `.solstice/trash/` rather than deleting it.
    fn trash(&mut self, rel: &str) -> std::io::Result<()> {
        let from = self.abs(rel);
        if !from.exists() {
            return Ok(());
        }
        let stamp = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .map_or(0, |d| d.as_secs());
        let to = self
            .root
            .join(OWN)
            .join("trash")
            .join(format!("{stamp} {}", rel.replace('/', " ∕ ")));
        std::fs::create_dir_all(to.parent().expect("trash has a parent"))?;
        std::fs::rename(&from, &to)?;
        self.seen.remove(rel);
        Ok(())
    }

    fn rename(&mut self, from: &str, to: &str) -> std::io::Result<()> {
        let (a, b) = (self.abs(from), self.abs(to));
        if let Some(parent) = b.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::rename(&a, &b)?;
        if let Some(found) = self.seen.remove(from) {
            self.seen.insert(to.to_string(), found);
        }
        Ok(())
    }

    // ------------------------------------------------------------ blobs

    fn blob_path(&self, hash: &str) -> PathBuf {
        self.root.join(OWN).join("blobs").join(hash)
    }

    /// Keeps an attachment's bytes by hash; returns the hash.
    pub fn put_blob(&self, bytes: &[u8]) -> std::io::Result<String> {
        let hash = content_hash(bytes);
        let path = self.blob_path(&hash);
        if !path.exists() {
            std::fs::create_dir_all(path.parent().expect("blobs has a parent"))?;
            std::fs::write(&path, bytes)?;
        }
        Ok(hash)
    }

    /// An attachment's bytes: from the cache, or any file that has them.
    pub fn get_blob(&self, hash: &str) -> Option<Vec<u8>> {
        if let Ok(bytes) = std::fs::read(self.blob_path(hash)) {
            return Some(bytes);
        }
        let rel = self
            .seen
            .iter()
            .find(|(_, f)| f.hash == hash)
            .map(|(rel, _)| rel.clone())?;
        self.read(&rel).ok().filter(|b| content_hash(b) == hash)
    }

    // ------------------------------------------------------------ syncing

    /// Writes the vault's files to disk: new and changed files, renames, and
    /// deletes (to the trash). Attachments whose bytes haven't arrived yet
    /// wait for the next call.
    pub fn materialize(&mut self, vault: &Vault) -> std::io::Result<()> {
        let target = vault.files();
        let live: HashMap<&FileId, &str> = target
            .iter()
            .map(|(path, (id, _))| (id, path.as_str()))
            .collect();

        let gone: Vec<FileId> = self
            .placed
            .keys()
            .filter(|id| !live.contains_key(id))
            .cloned()
            .collect();
        for id in gone {
            if let Some((path, _)) = self.placed.remove(&id) {
                self.trash(&path)?;
            }
        }

        for (path, (id, content)) in &target {
            let bytes = match content {
                Content::Note(text) => text.clone().into_bytes(),
                Content::Blob(hash) => match self.get_blob(hash) {
                    Some(bytes) => bytes,
                    None => continue,
                },
            };
            let hash = content_hash(&bytes);
            if let Some((old, _)) = self.placed.get(id).cloned() {
                if old != *path && self.abs(&old).exists() && !self.abs(path).exists() {
                    self.rename(&old, path)?;
                }
            }
            if self.seen.get(path).map(|f| &f.hash) != Some(&hash) || !self.abs(path).exists() {
                self.write(path, &bytes)?;
            }
            self.placed.insert(id.clone(), (path.clone(), hash));
        }
        Ok(())
    }

    /// Turns what changed on disk since the last [`materialize`] (or, on
    /// first use, everything that differs from the vault) into vault
    /// operations: edits, new files, renames (a vanished file and a new one
    /// with the same content) and deletes. Returns the messages for devices.
    ///
    /// [`materialize`]: VaultDir::materialize
    pub fn absorb(&mut self, vault: &mut Vault) -> std::io::Result<Vec<Msg>> {
        let disk = self.scan()?;
        let mut msgs = Vec::new();
        let first_run = self.placed.is_empty();
        let files = vault.files();

        // What the vault believes is on disk.
        let expected: Vec<(FileId, String, String)> = if first_run {
            files
                .iter()
                .map(|(path, (id, content))| {
                    let hash = match content {
                        Content::Note(text) => content_hash(text.as_bytes()),
                        Content::Blob(hash) => hash.clone(),
                    };
                    (id.clone(), path.clone(), hash)
                })
                .collect()
        } else {
            self.placed
                .iter()
                .map(|(id, (path, hash))| (id.clone(), path.clone(), hash.clone()))
                .collect()
        };
        let known: HashMap<&str, &FileId> = expected
            .iter()
            .map(|(id, path, _)| (path.as_str(), id))
            .collect();

        // Changed in place.
        for (id, path, hash) in &expected {
            let Some(found) = disk.get(path) else {
                continue;
            };
            if found.hash != *hash {
                msgs.extend(self.absorb_content(vault, id, path)?);
            }
        }

        // Vanished, and new.
        let mut vanished: Vec<&(FileId, String, String)> = expected
            .iter()
            .filter(|(_, path, _)| !disk.contains_key(path))
            .collect();
        for (path, found) in &disk {
            if known.contains_key(path.as_str()) {
                continue;
            }
            if let Some(i) = vanished.iter().position(|(_, _, hash)| *hash == found.hash) {
                let (id, _, _) = vanished.remove(i);
                msgs.extend(vault.rename(id, path).map_err(other)?);
                continue;
            }
            msgs.extend(self.absorb_new(vault, path)?);
        }
        for (id, _, _) in vanished {
            msgs.extend(vault.delete(id));
        }

        // Write back the vault's view: numbered clashes, normalized paths.
        self.materialize(vault)?;
        Ok(msgs)
    }

    fn absorb_content(
        &mut self,
        vault: &mut Vault,
        id: &str,
        path: &str,
    ) -> std::io::Result<Vec<Msg>> {
        let bytes = self.read(path)?;
        match Kind::for_path(path) {
            Kind::Note => {
                let text = String::from_utf8_lossy(&bytes);
                vault.save_note(id, &text, None).map_err(other)
            }
            Kind::Blob => {
                let hash = self.put_blob(&bytes)?;
                Ok(vault.set_blob(id, &hash))
            }
        }
    }

    fn absorb_new(&mut self, vault: &mut Vault, path: &str) -> std::io::Result<Vec<Msg>> {
        let bytes = self.read(path)?;
        let created = match Kind::for_path(path) {
            Kind::Note => vault.create_note(path, &String::from_utf8_lossy(&bytes)),
            Kind::Blob => {
                let hash = self.put_blob(&bytes)?;
                vault.create_blob(path, &hash)
            }
        };
        match created {
            Ok((_, msgs)) => Ok(msgs),
            Err(e) => {
                // A name sync can't carry (it shouldn't happen: hidden paths
                // are skipped); leave the file alone.
                tracing::warn!(path, error = %e, "file not added to the vault");
                Ok(vec![])
            }
        }
    }
}

fn other(e: solstice_sync::Error) -> std::io::Error {
    std::io::Error::other(e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dir() -> (tempfile::TempDir, VaultDir) {
        let tmp = tempfile::tempdir().unwrap();
        let vd = VaultDir::open(tmp.path().join("Notes")).unwrap();
        (tmp, vd)
    }

    #[test]
    fn writes_renames_and_trashes() {
        let (_tmp, mut vd) = dir();
        let mut vault = Vault::new("server");
        let (id, _) = vault.create_note("notes/a.md", "hello").unwrap();
        vd.materialize(&vault).unwrap();
        assert_eq!(
            std::fs::read_to_string(vd.root().join("notes/a.md")).unwrap(),
            "hello"
        );

        vault.rename(&id, "b.md").unwrap();
        vd.materialize(&vault).unwrap();
        assert!(!vd.root().join("notes/a.md").exists());
        assert_eq!(
            std::fs::read_to_string(vd.root().join("b.md")).unwrap(),
            "hello"
        );

        vault.delete(&id);
        vd.materialize(&vault).unwrap();
        assert!(!vd.root().join("b.md").exists());
        let trash: Vec<_> = std::fs::read_dir(vd.root().join(".solstice/trash"))
            .unwrap()
            .collect();
        assert_eq!(trash.len(), 1);
    }

    #[test]
    fn absorbs_edits_made_on_disk() {
        let (_tmp, mut vd) = dir();
        let mut vault = Vault::new("server");
        let (a, _) = vault.create_note("a.md", "one").unwrap();
        let (gone, _) = vault.create_note("gone.md", "bye").unwrap();
        let (moved, _) = vault.create_note("old.md", "same bytes").unwrap();
        vd.materialize(&vault).unwrap();

        let root = vd.root().to_path_buf();
        std::fs::write(root.join("a.md"), "one, edited").unwrap();
        std::fs::remove_file(root.join("gone.md")).unwrap();
        std::fs::rename(root.join("old.md"), root.join("new.md")).unwrap();
        std::fs::write(root.join("fresh.md"), "new here").unwrap();
        std::fs::create_dir_all(root.join(".git")).unwrap();
        std::fs::write(root.join(".git/HEAD"), "ignored").unwrap();
        std::fs::write(root.join("pic.png"), [1u8, 2, 3]).unwrap();

        let msgs = vd.absorb(&mut vault).unwrap();
        assert!(!msgs.is_empty());
        assert_eq!(vault.note(&a).unwrap().text(), "one, edited");
        assert!(!vault.manifest.entry(&gone).unwrap().is_live());
        assert_eq!(vault.manifest.entry(&moved).unwrap().path, "new.md");
        let files = vault.files();
        assert!(files.contains_key("fresh.md"));
        assert!(matches!(&files["pic.png"].1, Content::Blob(h) if *h == content_hash(&[1, 2, 3])));
        assert!(!files.keys().any(|p| p.starts_with(".git")));

        // Nothing changed since: nothing to send.
        assert!(vd.absorb(&mut vault).unwrap().is_empty());
    }

    #[test]
    fn a_first_absorb_imports_an_existing_folder() {
        let (_tmp, mut vd) = dir();
        std::fs::write(vd.root().join("Existing.md"), "from before").unwrap();
        let mut vault = Vault::new("server");
        vd.absorb(&mut vault).unwrap();
        assert!(matches!(&vault.files()["Existing.md"].1, Content::Note(t) if t == "from before"));
    }

    #[test]
    fn serves_blobs_by_hash() {
        let (_tmp, vd) = dir();
        let hash = vd.put_blob(b"bytes").unwrap();
        assert_eq!(vd.get_blob(&hash).unwrap(), b"bytes");
        assert!(vd.get_blob("missing").is_none());
    }
}
