//! One replica of a vault: its manifest and note documents, with the local
//! operations every replica (server or device) performs. Each operation
//! returns the messages to send to peers.

use std::collections::BTreeMap;

use sha2::{Digest, Sha256};
use yrs::{Snapshot, StateVector};

use crate::manifest::{Deleted, Entry, FileId, Kind, Manifest, Review, ReviewKind};
use crate::note::{decode_state_vector, NoteDoc};
use crate::protocol::{Body, DocKey, Msg};
use crate::Error;
use solstice_core::VaultPath;

/// SHA-256 of a file's bytes, as lowercase hex.
pub fn content_hash(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

/// What a file holds, for writing it out or comparing replicas.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Content {
    Note(String),
    /// A blob's hash; its bytes travel separately.
    Blob(String),
}

pub struct Vault {
    pub manifest: Manifest,
    pub(crate) notes: BTreeMap<FileId, NoteDoc>,
    /// Shown on reviews this replica records ("laptop", "server").
    pub device: String,
}

pub(crate) fn update(doc: DocKey, epoch: u32, update: Vec<u8>) -> Msg {
    Msg {
        doc,
        epoch,
        body: Body::Update { update },
    }
}

/// A vault path, normalized; hidden paths (`.solstice/`, `.git/`) never sync.
fn checked(path: &str) -> Result<String, Error> {
    let path = VaultPath::parse(path)?;
    if path.is_hidden() {
        return Err(Error::Hidden(path.to_string()));
    }
    Ok(path.to_string())
}

pub(crate) fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_millis() as i64)
}

impl Vault {
    pub fn new(device: impl Into<String>) -> Self {
        Self {
            manifest: Manifest::new(0),
            notes: BTreeMap::new(),
            device: device.into(),
        }
    }

    /// A replica from stored state.
    pub fn load(
        device: impl Into<String>,
        manifest: Manifest,
        notes: impl IntoIterator<Item = (FileId, NoteDoc)>,
    ) -> Self {
        Self {
            manifest,
            notes: notes.into_iter().collect(),
            device: device.into(),
        }
    }

    pub fn note(&self, id: &str) -> Option<&NoteDoc> {
        self.notes.get(id)
    }

    pub fn notes(&self) -> impl Iterator<Item = (&FileId, &NoteDoc)> {
        self.notes.iter()
    }

    /// Replaces a note's document wholesale (an epoch reset).
    pub(crate) fn replace_note(&mut self, id: &str, note: NoteDoc) {
        self.notes.insert(id.to_string(), note);
    }

    pub(crate) fn note_or_new(&mut self, id: &str, epoch: u32) -> &NoteDoc {
        self.notes
            .entry(id.to_string())
            .or_insert_with(|| NoteDoc::new(epoch))
    }

    /// The live files, by their place on disk.
    pub fn files(&self) -> BTreeMap<String, (FileId, Content)> {
        let entries = self.manifest.entries();
        self.manifest
            .materialize()
            .into_iter()
            .filter_map(|(path, id)| {
                let entry = entries.get(&id)?;
                let content = match entry.kind {
                    Kind::Note => {
                        Content::Note(self.notes.get(&id).map(NoteDoc::text).unwrap_or_default())
                    }
                    Kind::Blob => Content::Blob(entry.hash.clone().unwrap_or_default()),
                };
                Some((path, (id, content)))
            })
            .collect()
    }

    /// The id of the live file at `path` (as materialized), if any.
    pub fn id_at(&self, path: &str) -> Option<FileId> {
        self.manifest.materialize().remove(path)
    }

    fn manifest_msg(&self, bytes: Vec<u8>) -> Msg {
        update(DocKey::Manifest, self.manifest.epoch, bytes)
    }

    pub fn create_note(&mut self, path: &str, text: &str) -> Result<(FileId, Vec<Msg>), Error> {
        let path = checked(path)?;
        let (id, m) = self.manifest.create(&path, None);
        let note = NoteDoc::with_text(text, 0);
        let state = note.encode_state();
        self.notes.insert(id.clone(), note);
        let msgs = vec![
            self.manifest_msg(m),
            update(DocKey::Note(id.clone()), 0, state),
        ];
        Ok((id, msgs))
    }

    /// A file save. See [`NoteDoc::apply_save`] for `base`.
    pub fn save_note(
        &mut self,
        id: &str,
        text: &str,
        base: Option<&Snapshot>,
    ) -> Result<Vec<Msg>, Error> {
        let note = self
            .notes
            .get(id)
            .ok_or_else(|| Error::UnknownFile(id.to_string()))?;
        Ok(note
            .apply_save(text, base)?
            .map(|u| vec![update(DocKey::Note(id.to_string()), note.epoch, u)])
            .unwrap_or_default())
    }

    pub fn create_blob(&mut self, path: &str, hash: &str) -> Result<(FileId, Vec<Msg>), Error> {
        let path = checked(path)?;
        let (id, m) = self.manifest.create(&path, Some(hash));
        Ok((id, vec![self.manifest_msg(m)]))
    }

    pub fn set_blob(&mut self, id: &str, hash: &str) -> Vec<Msg> {
        if self.manifest.entry(id).and_then(|e| e.hash).as_deref() == Some(hash) {
            return vec![];
        }
        vec![self.manifest_msg(self.manifest.set_hash(id, hash))]
    }

    pub fn rename(&mut self, id: &str, path: &str) -> Result<Vec<Msg>, Error> {
        let path = checked(path)?;
        Ok(vec![self.manifest_msg(self.manifest.set_path(id, &path))])
    }

    pub fn delete(&mut self, id: &str) -> Vec<Msg> {
        let Some(entry) = self.manifest.entry(id) else {
            return vec![];
        };
        let how = match entry.kind {
            Kind::Note => Deleted::Note(
                self.notes
                    .get(id)
                    .map(NoteDoc::state_vector)
                    .unwrap_or_default(),
            ),
            Kind::Blob => Deleted::Blob(entry.hash.unwrap_or_default()),
        };
        vec![self.manifest_msg(self.manifest.delete(id, how))]
    }

    /// Server: replaces a note's history with `text` under a new epoch, for
    /// when its stored state was lost but the file survived. Devices reset
    /// their copy when they see the new epoch (see `Session`).
    pub fn rebuild_note(&mut self, id: &str, text: &str) -> Vec<Msg> {
        let epoch = self.notes.get(id).map_or(0, |n| n.epoch) + 1;
        let note = NoteDoc::with_text(text, epoch);
        let state = note.encode_state();
        self.notes.insert(id.to_string(), note);
        vec![update(DocKey::Note(id.to_string()), epoch, state)]
    }

    pub fn resolve_review(&mut self, id: &str) -> Vec<Msg> {
        vec![self.manifest_msg(self.manifest.resolve_review(id))]
    }

    pub(crate) fn record_review(&mut self, id: &str, review: Review) -> Msg {
        self.manifest_msg(self.manifest.set_review(id, &review))
    }

    /// A free path for keeping a version beside another, e.g. with the
    /// label "this device": `notes/Plan.md` → `notes/Plan (this device).md`,
    /// then `notes/Plan (this device) 2.md` if that's taken.
    pub fn copy_path(&self, path: &str, label: &str) -> String {
        let name_start = path.rfind('/').map_or(0, |i| i + 1);
        let (stem, ext) = match path[name_start..].rfind('.') {
            Some(dot) if dot > 0 => path.split_at(name_start + dot),
            _ => (path, ""),
        };
        let taken = self.manifest.materialize();
        let free = |p: &str| !taken.keys().any(|t| t.eq_ignore_ascii_case(p));
        let first = format!("{stem} ({label}){ext}");
        (1..)
            .map(|n| {
                if n == 1 {
                    first.clone()
                } else {
                    crate::manifest::numbered(&first, n)
                }
            })
            .find(|p| free(p))
            .expect("some number is free")
    }

    /// Rules that keep edits from being lost to deletes, run after merging
    /// remote changes. Deterministic, so replicas that run it at the same
    /// time agree:
    ///
    /// - A note deleted while another side was still editing it (its text
    ///   has changes the deleter hadn't seen) comes back, flagged.
    /// - A blob deleted while another side replaced it comes back.
    pub fn reconcile(&mut self) -> Vec<Msg> {
        let mut msgs = Vec::new();
        for entry in self.manifest.entries().into_values() {
            let restore = match &entry.deleted {
                Some(Deleted::Note(at_delete)) => self.edited_since(&entry, at_delete),
                Some(Deleted::Blob(hash)) => entry.hash.as_deref() != Some(hash.as_str()),
                None => false,
            };
            if restore {
                msgs.push(self.manifest_msg(self.manifest.restore(&entry.id)));
                if entry.kind == Kind::Note {
                    let review = Review {
                        kind: ReviewKind::Restored,
                        at: now_ms(),
                        device: self.device.clone(),
                        base: None,
                        local: None,
                        remote: None,
                    };
                    msgs.push(self.record_review(&entry.id, review));
                }
            }
        }
        msgs
    }

    fn edited_since(&self, entry: &Entry, at_delete: &[u8]) -> bool {
        let Some(note) = self.notes.get(&entry.id) else {
            return false;
        };
        let Ok(deleted_sv) = decode_state_vector(at_delete) else {
            return false;
        };
        let current: StateVector = note_state_vector(note);
        // Anything the deleter hadn't seen is an edit made after (or during)
        // the delete.
        current
            .iter()
            .any(|(client, clock)| deleted_sv.get(client) < *clock)
    }
}

fn note_state_vector(note: &NoteDoc) -> StateVector {
    decode_state_vector(&note.state_vector()).unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn checks_paths() {
        let mut vault = Vault::new("test");
        assert!(matches!(
            vault.create_note("../escape.md", ""),
            Err(Error::Path(_))
        ));
        assert!(matches!(
            vault.create_note(".solstice/x.md", ""),
            Err(Error::Hidden(_))
        ));
        let (id, _) = vault.create_note(r"notes\Plan.md", "").unwrap();
        assert_eq!(vault.manifest.entry(&id).unwrap().path, "notes/Plan.md");
        assert!(vault.rename(&id, "/abs.md").is_err());
    }

    #[test]
    fn names_copies() {
        let mut vault = Vault::new("test");
        vault.create_note("Plan (this device).md", "").unwrap();
        assert_eq!(
            vault.copy_path("Plan.md", "this device"),
            "Plan (this device) 2.md"
        );
        assert_eq!(
            vault.copy_path("img/a.png", "other device"),
            "img/a (other device).png"
        );
    }
}
