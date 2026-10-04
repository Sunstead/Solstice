//! The sync protocol for one connection, on either end. Transport-agnostic:
//! feed it the peer's messages, send what it returns.
//!
//! A device sends `Step1` for every document it has; the server answers each
//! with a `Step2` carrying what the device is missing plus its own state
//! vector; the device applies that and answers with a `Step2` of what the
//! server is missing. After that, both sides send `Update`s as changes
//! happen, and the server forwards each to the vault's other connections.
//!
//! The device is where merges are judged: when a `Step2` brings in remote
//! changes, it rebuilds the common base and both sides' texts and flags the
//! merge if their edits overlapped.

use std::collections::BTreeMap;

use yrs::{Snapshot, StateVector};

use crate::manifest::{Kind, Review, ReviewKind};
use crate::note::{decode_snapshot, decode_state_vector, decode_update, encode_snapshot, NoteDoc};
use crate::overlap::overlaps;
use crate::protocol::{Body, DocKey, Msg};
use crate::vault::{now_ms, update, Vault};
use crate::Error;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Role {
    /// A device: syncs with the server, judges merges.
    Device,
    /// The server's end of one device's connection.
    Server,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Event {
    /// A document changed through the peer: write it out.
    Changed(DocKey),
    /// Server: send this to the vault's other connections.
    Forward(Msg),
    /// A merge was flagged for review (the note's id).
    Review(String),
    /// Device: the server's manifest has a different epoch (it was rebuilt),
    /// so this vault has to be linked again.
    Relink,
}

#[derive(Debug, Default)]
pub struct Outcome {
    pub replies: Vec<Msg>,
    pub events: Vec<Event>,
}

pub struct Session {
    role: Role,
    /// Device: each document's server state as last reported, for when the
    /// server's epoch changes and the old history has to be let go.
    seen: BTreeMap<DocKey, Snapshot>,
}

impl Session {
    pub fn device() -> Self {
        Self {
            role: Role::Device,
            seen: BTreeMap::new(),
        }
    }

    pub fn server() -> Self {
        Self {
            role: Role::Server,
            seen: BTreeMap::new(),
        }
    }

    pub fn role(&self) -> Role {
        self.role
    }

    /// What a device stores between runs.
    pub fn export_seen(&self) -> Vec<(DocKey, Vec<u8>)> {
        self.seen
            .iter()
            .map(|(k, s)| (k.clone(), encode_snapshot(s)))
            .collect()
    }

    pub fn import_seen(
        &mut self,
        seen: impl IntoIterator<Item = (DocKey, Vec<u8>)>,
    ) -> Result<(), Error> {
        for (key, bytes) in seen {
            self.seen.insert(key, decode_snapshot(&bytes)?);
        }
        Ok(())
    }

    /// Device: the messages that start a sync (a `Step1` per document).
    pub fn open(&self, vault: &Vault) -> Vec<Msg> {
        let mut msgs = vec![Msg {
            doc: DocKey::Manifest,
            epoch: vault.manifest.epoch,
            body: Body::Step1 {
                sv: vault.manifest.state_vector(),
            },
        }];
        for (id, note) in vault.notes() {
            msgs.push(Msg {
                doc: DocKey::Note(id.clone()),
                epoch: note.epoch,
                body: Body::Step1 {
                    sv: note.state_vector(),
                },
            });
        }
        msgs
    }

    pub fn receive(&mut self, vault: &mut Vault, msg: Msg) -> Result<Outcome, Error> {
        match self.role {
            Role::Server => self.serve(vault, msg),
            Role::Device => self.device_receive(vault, msg),
        }
    }

    // ------------------------------------------------------------ server

    fn serve(&mut self, vault: &mut Vault, msg: Msg) -> Result<Outcome, Error> {
        let mut out = Outcome::default();
        let (epoch, state_vector) = server_doc(vault, &msg.doc, msg.epoch);

        // A device on another epoch gets the whole document and resets.
        if msg.epoch != epoch {
            out.replies.push(Msg {
                doc: msg.doc.clone(),
                epoch,
                body: Body::Step2 {
                    update: encode_state(vault, &msg.doc),
                    sv: Some(state_vector),
                },
            });
            return Ok(out);
        }

        match msg.body {
            Body::Step1 { sv } => out.replies.push(Msg {
                doc: msg.doc.clone(),
                epoch,
                body: Body::Step2 {
                    update: encode_diff(vault, &msg.doc, &sv)?,
                    sv: Some(state_vector),
                },
            }),
            Body::Step2 { update: bytes, sv } => {
                apply_update(vault, &msg.doc, &bytes)?;
                out.events.push(Event::Changed(msg.doc.clone()));
                out.events
                    .push(Event::Forward(update(msg.doc.clone(), epoch, bytes)));
                if let Some(sv) = sv {
                    out.replies.push(Msg {
                        doc: msg.doc.clone(),
                        epoch,
                        body: Body::Step2 {
                            update: encode_diff(vault, &msg.doc, &sv)?,
                            sv: None,
                        },
                    });
                }
            }
            Body::Update { update: bytes } => {
                apply_update(vault, &msg.doc, &bytes)?;
                out.events.push(Event::Changed(msg.doc.clone()));
                out.events
                    .push(Event::Forward(update(msg.doc, epoch, bytes)));
            }
        }
        Ok(out)
    }

    // ------------------------------------------------------------ device

    fn device_receive(&mut self, vault: &mut Vault, msg: Msg) -> Result<Outcome, Error> {
        let mut out = Outcome::default();
        let local_epoch = match &msg.doc {
            DocKey::Manifest => vault.manifest.epoch,
            DocKey::Note(id) => vault.note(id).map_or(msg.epoch, |n| n.epoch),
        };

        match msg.body {
            Body::Step1 { sv } => out.replies.push(Msg {
                doc: msg.doc.clone(),
                epoch: local_epoch,
                body: Body::Step2 {
                    update: encode_diff(vault, &msg.doc, &sv)?,
                    sv: None,
                },
            }),

            Body::Update { update: bytes } => {
                if msg.epoch != local_epoch {
                    // Ask again; the server answers a stale epoch with the
                    // whole document, and the Step2 below resets.
                    out.replies.push(Msg {
                        doc: msg.doc.clone(),
                        epoch: local_epoch,
                        body: Body::Step1 {
                            sv: state_vector(vault, &msg.doc),
                        },
                    });
                } else {
                    apply_update(vault, &msg.doc, &bytes)?;
                    out.events.push(Event::Changed(msg.doc));
                    out.replies.extend(vault.reconcile());
                }
            }

            Body::Step2 { update: bytes, sv } => {
                let server_sv = sv.as_deref().map(decode_state_vector).transpose()?;
                let stale = msg.epoch != local_epoch;
                match (&msg.doc, stale) {
                    (DocKey::Manifest, true) => {
                        // Nothing more to say until the vault is linked again.
                        out.events.push(Event::Relink);
                        return Ok(out);
                    }
                    (DocKey::Note(id), true) => {
                        self.reset_note(vault, id, msg.epoch, &bytes, &mut out)?
                    }
                    (DocKey::Manifest, false) => {
                        self.merge_manifest(vault, &bytes, server_sv.as_ref(), &mut out)?
                    }
                    (DocKey::Note(id), false) => {
                        self.merge_note(vault, id, &bytes, server_sv.as_ref(), &mut out)?
                    }
                }
                if let Some(sv) = sv {
                    // The server asked for what it's missing.
                    out.replies.push(Msg {
                        doc: msg.doc.clone(),
                        epoch: msg.epoch,
                        body: Body::Step2 {
                            update: encode_diff(vault, &msg.doc, &sv)?,
                            sv: None,
                        },
                    });
                }
            }
        }
        Ok(out)
    }

    fn merge_note(
        &mut self,
        vault: &mut Vault,
        id: &str,
        bytes: &[u8],
        server_sv: Option<&StateVector>,
        out: &mut Outcome,
    ) -> Result<(), Error> {
        let epoch = vault.note(id).map_or(0, |n| n.epoch);
        let note = vault.note_or_new(id, epoch);
        let before = note.text();
        let local = note.snapshot();
        let incoming = decode_update(bytes)?;
        let remote = server_sv.map(|sv| Snapshot::new(sv.clone(), incoming.delete_set().clone()));
        note.apply_update(bytes)?;

        let mut review = None;
        if let Some(remote) = &remote {
            let base = common_base(&local, remote);
            let texts = (
                note.text_at(&base)?,
                note.text_at(&local)?,
                note.text_at(remote)?,
            );
            if overlaps(&texts.0, &texts.1, &texts.2) {
                review = Some(Review {
                    kind: ReviewKind::Overlap,
                    at: now_ms(),
                    device: vault.device.clone(),
                    base: Some(encode_snapshot(&base)),
                    local: Some(encode_snapshot(&local)),
                    remote: Some(encode_snapshot(remote)),
                });
            }
            self.seen
                .insert(DocKey::Note(id.to_string()), remote.clone());
        }
        let changed = vault.note(id).map(NoteDoc::text).as_deref() != Some(before.as_str());
        if let Some(review) = review {
            out.replies.push(vault.record_review(id, review));
            out.events.push(Event::Review(id.to_string()));
        }
        if changed {
            out.events
                .push(Event::Changed(DocKey::Note(id.to_string())));
        }
        out.replies.extend(vault.reconcile());
        Ok(())
    }

    fn merge_manifest(
        &mut self,
        vault: &mut Vault,
        bytes: &[u8],
        server_sv: Option<&StateVector>,
        out: &mut Outcome,
    ) -> Result<(), Error> {
        let local = vault.manifest.snapshot();
        let before = vault.manifest.entries();
        let incoming = decode_update(bytes)?;
        let remote = server_sv.map(|sv| Snapshot::new(sv.clone(), incoming.delete_set().clone()));
        vault.manifest.apply_update(bytes)?;
        out.events.push(Event::Changed(DocKey::Manifest));

        if let Some(remote) = &remote {
            // A blob replaced on both sides: the merge keeps one, so keep the
            // other beside it. Only the device doing this merge can see both
            // (the other may have synced and gone), so it keeps whichever
            // lost, its own or the other side's.
            let base = vault.manifest.at(&common_base(&local, remote))?.entries();
            let theirs = vault.manifest.at(remote)?.entries();
            let after = vault.manifest.entries();
            for (id, mine) in &before {
                let (Some(merged), Some(my_hash)) = (after.get(id), mine.hash.as_ref()) else {
                    continue;
                };
                let Some(their_hash) = theirs.get(id).and_then(|e| e.hash.as_ref()) else {
                    continue;
                };
                let base_hash = base.get(id).and_then(|e| e.hash.as_ref());
                let both_changed = base_hash != Some(my_hash)
                    && base_hash != Some(their_hash)
                    && my_hash != their_hash;
                if mine.kind != Kind::Blob || !mine.is_live() || !both_changed {
                    continue;
                }
                let (lost, label) = if merged.hash.as_ref() == Some(my_hash) {
                    (their_hash, "other device")
                } else {
                    (my_hash, "this device")
                };
                let path = vault.copy_path(&merged.path, label);
                out.replies.extend(vault.create_blob(&path, lost)?.1);
            }
            self.seen.insert(DocKey::Manifest, remote.clone());
        }

        // Notes the manifest knows and this device doesn't: ask for them.
        let entries = vault.manifest.entries();
        for (id, entry) in &entries {
            if entry.kind == Kind::Note && vault.note(id).is_none() {
                let note = vault.note_or_new(id, 0);
                out.replies.push(Msg {
                    doc: DocKey::Note(id.clone()),
                    epoch: note.epoch,
                    body: Body::Step1 {
                        sv: note.state_vector(),
                    },
                });
            }
        }
        out.replies.extend(vault.reconcile());
        Ok(())
    }

    /// The server rebuilt this note (a new epoch), so its history no longer
    /// lines up with ours. Keep whatever this device changed that the server
    /// doesn't have, without ever merging the two histories.
    fn reset_note(
        &mut self,
        vault: &mut Vault,
        id: &str,
        epoch: u32,
        state: &[u8],
        out: &mut Outcome,
    ) -> Result<(), Error> {
        let key = DocKey::Note(id.to_string());
        let server = NoteDoc::load(state, epoch)?;
        let server_text = server.text();
        let (local_text, last_seen) = match vault.note(id) {
            Some(old) => (
                old.text(),
                self.seen.get(&key).map(|s| old.text_at(s)).transpose()?,
            ),
            None => (String::new(), None),
        };
        let never_synced = last_seen.is_none() && local_text.is_empty();
        let unchanged_here =
            last_seen.as_deref() == Some(local_text.as_str()) || local_text == server_text;
        let unchanged_there = last_seen.as_deref() == Some(server_text.as_str());

        if never_synced || unchanged_here {
            // Nothing of ours to keep.
        } else if unchanged_there {
            // Only we changed it: replay our text on the new history.
            if let Some(u) = server.apply_save(&local_text, None)? {
                out.replies.push(update(key.clone(), epoch, u));
            }
        } else {
            // Both changed it: keep ours beside it.
            let path = vault
                .manifest
                .entry(id)
                .map(|e| vault.copy_path(&e.path, "this device"))
                .unwrap_or_else(|| "Recovered (this device).md".into());
            out.replies.extend(vault.create_note(&path, &local_text)?.1);
        }
        self.seen.insert(key.clone(), server.snapshot());
        vault.replace_note(id, server);
        out.events.push(Event::Changed(key));
        Ok(())
    }
}

/// The last state both sides shared: for each author, the lower of the two
/// clocks, and the deletions both had made.
fn common_base(local: &Snapshot, remote: &Snapshot) -> Snapshot {
    let mut sv = StateVector::default();
    for (client, clock) in local.state_map.iter() {
        let shared = (*clock).min(remote.state_map.get(client));
        if shared > 0 {
            sv.set_max(*client, shared);
        }
    }
    Snapshot::new(sv, local.delete_set.intersect(&remote.delete_set))
}

/// The server's epoch and state vector for a document, creating an empty
/// note on first contact (a device made it offline).
fn server_doc(vault: &mut Vault, doc: &DocKey, device_epoch: u32) -> (u32, Vec<u8>) {
    match doc {
        DocKey::Manifest => (vault.manifest.epoch, vault.manifest.state_vector()),
        DocKey::Note(id) => {
            let note = vault.note_or_new(id, device_epoch);
            (note.epoch, note.state_vector())
        }
    }
}

fn state_vector(vault: &Vault, doc: &DocKey) -> Vec<u8> {
    match doc {
        DocKey::Manifest => vault.manifest.state_vector(),
        DocKey::Note(id) => vault
            .note(id)
            .map(NoteDoc::state_vector)
            .unwrap_or_else(|| NoteDoc::new(0).state_vector()),
    }
}

fn encode_state(vault: &Vault, doc: &DocKey) -> Vec<u8> {
    match doc {
        DocKey::Manifest => vault.manifest.encode_state(),
        DocKey::Note(id) => vault
            .note(id)
            .map(NoteDoc::encode_state)
            .unwrap_or_default(),
    }
}

fn encode_diff(vault: &Vault, doc: &DocKey, sv: &[u8]) -> Result<Vec<u8>, Error> {
    match doc {
        DocKey::Manifest => vault.manifest.encode_diff(sv),
        DocKey::Note(id) => match vault.note(id) {
            Some(note) => note.encode_diff(sv),
            None => NoteDoc::new(0).encode_diff(sv),
        },
    }
}

fn apply_update(vault: &mut Vault, doc: &DocKey, bytes: &[u8]) -> Result<(), Error> {
    match doc {
        DocKey::Manifest => vault.manifest.apply_update(bytes),
        DocKey::Note(id) => {
            let epoch = vault.note(id).map_or(0, |n| n.epoch);
            vault.note_or_new(id, epoch).apply_update(bytes)
        }
    }
}
