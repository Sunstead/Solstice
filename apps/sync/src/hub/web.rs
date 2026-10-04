//! What the web app asks of a vault, done in its task like a device's
//! changes: through the engine, so devices get them as ordinary sync, and
//! out to the folder. See `web_api.rs` for the routes.
//!
//! A note is read with a `base` (where its history was) and saved against
//! it, so a save from a stale editor keeps other devices' edits instead of
//! reverting them ([`NoteDoc::apply_save`]).

use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;

use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::json;
use solstice_sync::{decode_snapshot, encode_snapshot, Content, DocKey, Kind, Msg, ReviewKind};

use super::VaultTask;
use crate::error::{AppError, ErrorCode};

pub enum WebOp {
    Tree,
    ReadNote {
        path: String,
    },
    SaveNote {
        path: String,
        text: String,
        base: Option<String>,
    },
    ReadFile {
        path: String,
    },
    /// A file that isn't a note (an image, a canvas). `new`: never replace,
    /// pick a free name instead (an attachment).
    WriteFile {
        path: String,
        bytes: Vec<u8>,
        new: bool,
    },
    CreateNote {
        path: String,
        text: String,
    },
    CreateFolder {
        path: String,
    },
    Rename {
        from: String,
        to: String,
    },
    Trash {
        path: String,
    },
    Duplicate {
        path: String,
    },
    Reviews,
    Versions {
        path: String,
    },
    Resolve {
        path: String,
        text: Option<String>,
    },
}

impl WebOp {
    /// The vault paths this would change, as given.
    pub fn paths(&self) -> Vec<&str> {
        match self {
            WebOp::SaveNote { path, .. }
            | WebOp::WriteFile { path, .. }
            | WebOp::Trash { path }
            | WebOp::Resolve { path, .. } => vec![path],
            WebOp::Rename { from, to } => vec![from, to],
            _ => vec![],
        }
    }
}

pub enum WebReply {
    Json(serde_json::Value),
    File { path: String, bytes: Vec<u8> },
}

/// Where a note's text was when the web app read it. Opaque to the client.
#[derive(Serialize, Deserialize)]
struct Base {
    /// The note, so a save still lands if another device renamed it.
    id: String,
    epoch: u32,
    /// The encoded snapshot.
    s: String,
}

fn b64() -> base64::engine::GeneralPurpose {
    base64::engine::general_purpose::URL_SAFE_NO_PAD
}

fn encode_base(id: &str, epoch: u32, snapshot: &solstice_sync::Snapshot) -> String {
    let base = Base {
        id: id.into(),
        epoch,
        s: b64().encode(encode_snapshot(snapshot)),
    };
    b64().encode(serde_json::to_vec(&base).expect("serializes"))
}

fn decode_base(token: &str) -> Result<Base, AppError> {
    b64()
        .decode(token)
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .ok_or_else(|| AppError::bad_request("that isn't a note's base"))
}

fn stale() -> AppError {
    AppError::new(
        ErrorCode::Conflict,
        "This note changed in a way that can't be merged into; reload it",
    )
}

/// A vault path from a request: normalized, and never hidden (`.solstice/`).
pub fn checked(path: &str) -> Result<String, AppError> {
    match solstice_core::VaultPath::parse(path) {
        Ok(p) if !p.is_hidden() => Ok(p.to_string()),
        Ok(_) => Err(AppError::bad_request(
            "hidden paths aren't part of the vault",
        )),
        Err(e) => Err(AppError::bad_request(e.to_string())),
    }
}

fn is_note_path(path: &str) -> bool {
    path.to_ascii_lowercase().ends_with(".md")
}

/// `Name copy.md`, then `Name copy 2.md`, as the desktop app names copies.
fn copy_name(path: &str, taken: &BTreeSet<String>) -> String {
    let name_start = path.rfind('/').map_or(0, |i| i + 1);
    let (stem, ext) = match path[name_start..].rfind('.') {
        Some(dot) if dot > 0 => path.split_at(name_start + dot),
        _ => (path, ""),
    };
    (1..)
        .map(|n| {
            if n == 1 {
                format!("{stem} copy{ext}")
            } else {
                format!("{stem} copy {n}{ext}")
            }
        })
        .find(|p| !taken.contains(&p.to_lowercase()))
        .expect("some number is free")
}

impl VaultTask {
    pub(super) fn web(&mut self, op: WebOp) -> Result<WebReply, AppError> {
        match op {
            WebOp::Tree => Ok(WebReply::Json(self.tree())),
            WebOp::ReadNote { path } => {
                let path = checked(&path)?;
                let id = self.note_at(&path)?;
                Ok(WebReply::Json(self.note_json(&id, &path)?))
            }
            WebOp::SaveNote { path, text, base } => {
                self.save_from_web(&path, &text, base.as_deref())
            }
            WebOp::ReadFile { path } => {
                let path = checked(&path)?;
                let id = self.vault.id_at(&path).ok_or_else(AppError::not_found)?;
                let entry = self
                    .vault
                    .manifest
                    .entry(&id)
                    .ok_or_else(AppError::not_found)?;
                let bytes = match entry.kind {
                    Kind::Note => self
                        .vault
                        .note(&id)
                        .map(|n| n.text().into_bytes())
                        .unwrap_or_default(),
                    Kind::Blob => entry
                        .hash
                        .as_deref()
                        .and_then(|h| self.dir.get_blob(h))
                        .or_else(|| self.dir.read(&path).ok())
                        .ok_or_else(AppError::not_found)?,
                };
                Ok(WebReply::File { path, bytes })
            }
            WebOp::WriteFile { path, bytes, new } => {
                let path = checked(&path)?;
                if is_note_path(&path) {
                    return Err(AppError::bad_request("save notes as notes"));
                }
                let hash = self.dir.put_blob(&bytes).map_err(AppError::internal)?;
                let existing = (!new)
                    .then(|| self.vault.id_at(&path))
                    .flatten()
                    .filter(|id| {
                        self.vault
                            .manifest
                            .entry(id)
                            .is_some_and(|e| e.kind == Kind::Blob)
                    });
                let (id, msgs) = match existing {
                    Some(id) => {
                        let msgs = self.vault.set_blob(&id, &hash);
                        (id, msgs)
                    }
                    None => self.vault.create_blob(&path, &hash)?,
                };
                self.changed(None, msgs);
                Ok(WebReply::Json(
                    json!({ "path": self.path_of(&id).unwrap_or(path) }),
                ))
            }
            WebOp::CreateNote { path, text } => {
                let path = checked(&path)?;
                if !is_note_path(&path) {
                    return Err(AppError::bad_request("a note's path must end in .md"));
                }
                let (id, msgs) = self.vault.create_note(&path, &text)?;
                self.changed(None, msgs);
                let path = self.path_of(&id).unwrap_or(path);
                Ok(WebReply::Json(json!({ "id": id, "path": path })))
            }
            WebOp::CreateFolder { path } => {
                let path = checked(&path)?;
                std::fs::create_dir_all(self.dir.root().join(&path)).map_err(AppError::internal)?;
                self.notify(true, &BTreeSet::new());
                Ok(WebReply::Json(json!({ "path": path })))
            }
            WebOp::Rename { from, to } => {
                let (from, to) = (checked(&from)?, checked(&to)?);
                let mut msgs = Vec::new();
                let placed = match self.vault.id_at(&from) {
                    Some(id) => {
                        msgs.extend(self.vault.rename(&id, &to)?);
                        id
                    }
                    None => {
                        let inside = self.files_under(&from);
                        let empty_dir = self.dir.root().join(&from).is_dir();
                        if inside.is_empty() && !empty_dir {
                            return Err(AppError::not_found());
                        }
                        for (path, id) in inside {
                            let rest = &path[from.len()..];
                            msgs.extend(self.vault.rename(&id, &format!("{to}{rest}"))?);
                        }
                        // Folders without files aren't synced: move them by hand.
                        let _ = std::fs::create_dir_all(self.dir.root().join(&to));
                        String::new()
                    }
                };
                self.changed(None, msgs);
                if placed.is_empty() {
                    self.remove_empty_dirs(&from);
                    self.notify(true, &BTreeSet::new());
                    Ok(WebReply::Json(json!({ "path": to })))
                } else {
                    Ok(WebReply::Json(
                        json!({ "path": self.path_of(&placed).unwrap_or(to) }),
                    ))
                }
            }
            WebOp::Trash { path } => {
                let path = checked(&path)?;
                let mut msgs = Vec::new();
                match self.vault.id_at(&path) {
                    Some(id) => msgs.extend(self.vault.delete(&id)),
                    None => {
                        let inside = self.files_under(&path);
                        if inside.is_empty() && !self.dir.root().join(&path).is_dir() {
                            return Err(AppError::not_found());
                        }
                        for (_, id) in inside {
                            msgs.extend(self.vault.delete(&id));
                        }
                    }
                }
                self.changed(None, msgs);
                self.remove_empty_dirs(&path);
                self.notify(true, &BTreeSet::new());
                Ok(WebReply::Json(json!({})))
            }
            WebOp::Duplicate { path } => {
                let path = checked(&path)?;
                let id = self.vault.id_at(&path).ok_or_else(AppError::not_found)?;
                let entry = self
                    .vault
                    .manifest
                    .entry(&id)
                    .ok_or_else(AppError::not_found)?;
                let taken: BTreeSet<String> = self
                    .vault
                    .files()
                    .into_keys()
                    .map(|p| p.to_lowercase())
                    .collect();
                let copy = copy_name(&path, &taken);
                let (new_id, msgs) = match entry.kind {
                    Kind::Note => {
                        let text = self.vault.note(&id).map(|n| n.text()).unwrap_or_default();
                        self.vault.create_note(&copy, &text)?
                    }
                    Kind::Blob => self
                        .vault
                        .create_blob(&copy, entry.hash.as_deref().unwrap_or_default())?,
                };
                self.changed(None, msgs);
                Ok(WebReply::Json(
                    json!({ "path": self.path_of(&new_id).unwrap_or(copy) }),
                ))
            }
            WebOp::Reviews => {
                let paths = self.paths_by_id();
                let list: Vec<_> = self
                    .vault
                    .manifest
                    .reviews()
                    .into_iter()
                    .filter_map(|(id, r)| {
                        Some(json!({
                            "path": paths.get(&id)?,
                            "kind": match r.kind {
                                ReviewKind::Overlap => "overlap",
                                ReviewKind::Restored => "restored",
                            },
                            "at": r.at,
                            "device": r.device,
                        }))
                    })
                    .collect();
                Ok(WebReply::Json(json!(list)))
            }
            WebOp::Versions { path } => {
                let path = checked(&path)?;
                let id = self.note_at(&path)?;
                let review = self
                    .vault
                    .manifest
                    .reviews()
                    .remove(&id)
                    .ok_or_else(AppError::not_found)?;
                let note = self.vault.note(&id).ok_or_else(AppError::not_found)?;
                let at = |s: &Option<Vec<u8>>| -> Result<Option<String>, AppError> {
                    match s {
                        Some(bytes) => Ok(Some(note.text_at(&decode_snapshot(bytes)?)?)),
                        None => Ok(None),
                    }
                };
                Ok(WebReply::Json(json!({
                    "base": at(&review.base)?,
                    "local": at(&review.local)?,
                    "remote": at(&review.remote)?,
                    "merged": note.text(),
                })))
            }
            WebOp::Resolve { path, text } => {
                let path = checked(&path)?;
                let id = self.note_at(&path)?;
                let mut msgs = Vec::new();
                if let Some(text) = text {
                    msgs.extend(self.vault.save_note(&id, &text, None)?);
                }
                msgs.extend(self.vault.resolve_review(&id));
                self.changed(None, msgs);
                Ok(WebReply::Json(self.note_json(&id, &path)?))
            }
        }
    }

    fn save_from_web(
        &mut self,
        path: &str,
        text: &str,
        base: Option<&str>,
    ) -> Result<WebReply, AppError> {
        let path = checked(path)?;
        if !is_note_path(&path) {
            return Err(AppError::bad_request("a note's path must end in .md"));
        }
        let base = base.map(decode_base).transpose()?;
        // The note the editor had open, even if it has moved since.
        let id = match (&base, self.vault.id_at(&path)) {
            (Some(b), _) if self.vault.note(&b.id).is_some() => b.id.clone(),
            (None, Some(id)) => id,
            (None, None) => {
                // A new note, written whole.
                let (id, msgs) = self.vault.create_note(&path, text)?;
                self.changed(None, msgs);
                let path = self.path_of(&id).unwrap_or(path);
                return Ok(WebReply::Json(self.note_json(&id, &path)?));
            }
            (Some(_), _) => return Err(AppError::not_found()),
        };
        let note = self.vault.note(&id).ok_or_else(AppError::not_found)?;
        let snapshot = match &base {
            Some(b) => {
                if b.epoch != note.epoch {
                    return Err(stale());
                }
                let bytes = b64().decode(&b.s).map_err(|_| stale())?;
                let snapshot = decode_snapshot(&bytes).map_err(|_| stale())?;
                if !note.has_seen(&snapshot) {
                    return Err(stale());
                }
                Some(snapshot)
            }
            None => None,
        };
        let msgs = self.vault.save_note(&id, text, snapshot.as_ref())?;
        self.changed(None, msgs);
        let path = self.path_of(&id).unwrap_or(path);
        Ok(WebReply::Json(self.note_json(&id, &path)?))
    }

    fn note_json(&self, id: &str, path: &str) -> Result<serde_json::Value, AppError> {
        let note = self.vault.note(id).ok_or_else(AppError::not_found)?;
        Ok(json!({
            "path": path,
            "text": note.text(),
            "base": encode_base(id, note.epoch, &note.snapshot()),
        }))
    }

    fn note_at(&self, path: &str) -> Result<String, AppError> {
        let id = self.vault.id_at(path).ok_or_else(AppError::not_found)?;
        match self.vault.manifest.entry(&id).map(|e| e.kind) {
            Some(Kind::Note) if self.vault.note(&id).is_some() => Ok(id),
            Some(Kind::Note) => Err(AppError::not_found()),
            _ => Err(AppError::bad_request("that file isn't a note")),
        }
    }

    fn path_of(&self, id: &str) -> Option<String> {
        self.paths_by_id().remove(id)
    }

    fn paths_by_id(&self) -> BTreeMap<String, String> {
        self.vault
            .manifest
            .materialize()
            .into_iter()
            .map(|(path, id)| (id, path))
            .collect()
    }

    /// Files inside a folder, by path.
    fn files_under(&self, folder: &str) -> Vec<(String, String)> {
        let prefix = format!("{folder}/");
        self.vault
            .manifest
            .materialize()
            .into_iter()
            .filter(|(p, _)| p.starts_with(&prefix))
            .collect()
    }

    /// Removes a folder left with nothing in it (and empty folders inside).
    fn remove_empty_dirs(&self, folder: &str) {
        fn prune(dir: &Path) -> bool {
            let Ok(entries) = std::fs::read_dir(dir) else {
                return false;
            };
            let mut empty = true;
            for entry in entries.flatten() {
                let is_dir = entry.file_type().is_ok_and(|t| t.is_dir());
                if !(is_dir && prune(&entry.path())) {
                    empty = false;
                }
            }
            empty && std::fs::remove_dir(dir).is_ok()
        }
        prune(&self.dir.root().join(folder));
    }

    /// Every file and folder, for the web app's tree. Folders come from the
    /// disk too, so an empty one made on the web shows up.
    fn tree(&self) -> serde_json::Value {
        let root = self.dir.root();
        let files: Vec<_> = self
            .vault
            .files()
            .into_iter()
            .map(|(path, (_, content))| {
                let meta = std::fs::metadata(root.join(&path)).ok();
                let size = match &content {
                    Content::Note(text) => text.len() as u64,
                    Content::Blob(_) => meta.as_ref().map_or(0, |m| m.len()),
                };
                let modified = meta
                    .and_then(|m| m.modified().ok())
                    .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                    .map_or(0, |d| d.as_millis() as u64);
                json!({
                    "path": path,
                    "kind": if matches!(content, Content::Note(_)) { "note" } else { "file" },
                    "size": size,
                    "modified": modified,
                })
            })
            .collect();
        let mut folders = BTreeSet::new();
        collect_folders(root, "", &mut folders);
        json!({ "files": files, "folders": folders })
    }

    /// Tells the web apps watching this vault what changed.
    pub(super) fn notify(&mut self, tree: bool, notes: &BTreeSet<String>) {
        self.watchers.retain(|w| !w.is_closed());
        if self.watchers.is_empty() || (!tree && notes.is_empty()) {
            return;
        }
        let paths = self.paths_by_id();
        let notes: Vec<&String> = notes.iter().filter_map(|id| paths.get(id)).collect();
        let event = json!({ "tree": tree, "notes": notes }).to_string();
        for w in &self.watchers {
            let _ = w.send(event.clone());
        }
    }

    /// The changes in `msgs`, for [`Self::notify`].
    pub(super) fn notify_msgs(&mut self, msgs: &[Msg]) {
        let tree = msgs.iter().any(|m| m.doc == DocKey::Manifest);
        let notes: BTreeSet<String> = msgs
            .iter()
            .filter_map(|m| match &m.doc {
                DocKey::Note(id) => Some(id.clone()),
                DocKey::Manifest => None,
            })
            .collect();
        self.notify(tree, &notes);
    }
}

fn collect_folders(dir: &Path, prefix: &str, out: &mut BTreeSet<String>) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let Some(name) = entry.file_name().to_str().map(str::to_owned) else {
            continue;
        };
        if name.starts_with('.') || !entry.file_type().is_ok_and(|t| t.is_dir()) {
            continue;
        }
        let path = format!("{prefix}{name}");
        collect_folders(&entry.path(), &format!("{path}/"), out);
        out.insert(path);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn checks_paths() {
        assert_eq!(checked(r"notes\a.md").unwrap(), "notes/a.md");
        for bad in ["../x.md", "/abs.md", ".solstice/x.md", "a/.git/b", ""] {
            assert!(checked(bad).is_err(), "{bad:?}");
        }
    }

    #[test]
    fn names_copies_like_the_desktop() {
        let mut taken = BTreeSet::new();
        assert_eq!(copy_name("a/Plan.md", &taken), "a/Plan copy.md");
        taken.insert("a/plan copy.md".into());
        assert_eq!(copy_name("a/Plan.md", &taken), "a/Plan copy 2.md");
        assert_eq!(copy_name("README", &BTreeSet::new()), "README copy");
    }

    #[test]
    fn a_base_is_opaque_but_checked() {
        assert!(decode_base("not a base").is_err());
        let s = solstice_sync::NoteDoc::with_text("x", 0).snapshot();
        let token = encode_base("id1", 3, &s);
        let b = decode_base(&token).unwrap();
        assert_eq!((b.id.as_str(), b.epoch), ("id1", 3));
    }
}
