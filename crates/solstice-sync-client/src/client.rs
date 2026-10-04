//! A linked folder kept in sync: one task that owns the vault's documents,
//! the folder, and the connection to the server.

use std::collections::{BTreeSet, HashMap, HashSet};
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use serde::Serialize;
use solstice_sync::{
    decode_snapshot, Content, DocKey, Event, Frame, Kind, Manifest, Msg, NoteDoc, ReviewKind,
    Session, Vault,
};
use solstice_sync_fs::VaultDir;
use tokio::sync::{mpsc, oneshot, watch};
use tokio::time::Instant;
use tokio_tungstenite::tungstenite::Message;

use crate::net::{Server, Socket, TokenSource};
use crate::store::{key_from_name, Link, Store, OWN};
use crate::Error;

const SAVE_AFTER: Duration = Duration::from_secs(2);
/// Quiet this long after connecting means synced.
const SETTLE: Duration = Duration::from_millis(800);
const MAX_BACKOFF: Duration = Duration::from_secs(60);
/// Access tokens are refreshed when older than this (Authentik's last 10
/// minutes; the WebSocket only needs one at connect).
const TOKEN_AGE: Duration = Duration::from_secs(4 * 60);

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "state", rename_all = "snake_case")]
pub enum Status {
    Connecting,
    /// Connected, catching up.
    Syncing,
    Synced,
    /// Not connected; changes wait here and sync on reconnect.
    Offline {
        message: String,
    },
    /// The server wants a sign-in.
    SignedOut,
    /// The vault was rebuilt on the server (or deleted): link again.
    Relink,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct ReviewInfo {
    pub id: String,
    /// Where the note is now, vault-relative.
    pub path: Option<String>,
    /// `overlap` or `restored`.
    pub kind: String,
    /// Unix milliseconds.
    pub at: i64,
    pub device: String,
}

/// A flagged merge's versions, for the review dialog.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct Versions {
    pub base: Option<String>,
    /// What the device that noticed it had.
    pub local: Option<String>,
    /// What the other side had.
    pub remote: Option<String>,
    pub merged: String,
}

enum Cmd {
    EditorOpened {
        rel: String,
        text: String,
    },
    Saved {
        rel: String,
        text: String,
    },
    FolderChanged,
    Reconnect,
    Reviews {
        reply: oneshot::Sender<Vec<ReviewInfo>>,
    },
    Versions {
        id: String,
        reply: oneshot::Sender<Result<Versions, Error>>,
    },
    Resolve {
        id: String,
        text: Option<String>,
        reply: oneshot::Sender<Result<(), Error>>,
    },
    BlobFetched {
        hash: String,
        result: Result<Vec<u8>, Error>,
    },
    Stop {
        done: oneshot::Sender<()>,
    },
}

/// A running sync for one linked folder. Cheap to clone.
#[derive(Clone)]
pub struct Client {
    tx: mpsc::UnboundedSender<Cmd>,
    status: watch::Receiver<Status>,
    reviews: watch::Receiver<u64>,
    link: Link,
    root: PathBuf,
}

impl Client {
    /// Starts syncing a linked folder (see [`crate::link`]).
    pub fn start(root: PathBuf, tokens: Arc<dyn TokenSource>) -> Result<Client, Error> {
        let (store, saved) = Store::open(&root)?;
        let server = Server::new(&saved.link.server)?;
        let mut manifest = None;
        let mut notes = Vec::new();
        for (name, epoch, state) in saved.docs {
            match key_from_name(&name) {
                Some(DocKey::Manifest) => manifest = Some(Manifest::load(&state, epoch)?),
                Some(DocKey::Note(id)) => notes.push((id, NoteDoc::load(&state, epoch)?)),
                None => {}
            }
        }
        let manifest = manifest.ok_or_else(|| Error::Store("no manifest saved".into()))?;
        let vault = Vault::load(saved.link.device.clone(), manifest, notes);
        let mut session = Session::device();
        session.import_seen(saved.seen)?;
        let mut dir = VaultDir::open(root.clone(), OWN).map_err(Error::io)?;
        if let Some(placed) = saved.placed {
            dir.set_placed(placed);
        }

        let (tx, rx) = mpsc::unbounded_channel();
        let (status_tx, status) = watch::channel(Status::Connecting);
        let (reviews_tx, reviews) = watch::channel(0u64);
        let actor = Actor {
            link: saved.link.clone(),
            server,
            tokens,
            token: None,
            store,
            vault,
            session,
            dir,
            replicas: HashMap::new(),
            uploaded: saved.uploaded,
            new_uploads: Vec::new(),
            fetching: HashSet::new(),
            dirty: BTreeSet::new(),
            status: status_tx,
            reviews: reviews_tx,
            tx: tx.clone(),
            backoff: Duration::from_secs(1),
            reconnect_at: Some(Instant::now()),
            connected_at: None,
            save_at: None,
            settle_at: None,
        };
        tokio::spawn(actor.run(rx));
        Ok(Client {
            tx,
            status,
            reviews,
            link: saved.link,
            root,
        })
    }

    pub fn link(&self) -> &Link {
        &self.link
    }

    pub fn root(&self) -> &std::path::Path {
        &self.root
    }

    pub fn status(&self) -> Status {
        self.status.borrow().clone()
    }

    pub fn watch_status(&self) -> watch::Receiver<Status> {
        self.status.clone()
    }

    /// Bumps whenever the list of reviews may have changed.
    pub fn watch_reviews(&self) -> watch::Receiver<u64> {
        self.reviews.clone()
    }

    /// An editor (re)loaded a note's text. `rel` is vault-relative, `/`-separated.
    pub fn editor_opened(&self, rel: &str, text: &str) {
        let _ = self.tx.send(Cmd::EditorOpened {
            rel: rel.into(),
            text: text.into(),
        });
    }

    /// The app just wrote `text` to `rel` (an editor saved).
    pub fn saved(&self, rel: &str, text: &str) {
        let _ = self.tx.send(Cmd::Saved {
            rel: rel.into(),
            text: text.into(),
        });
    }

    /// Try connecting now (after signing in, or when the network returns).
    pub fn reconnect(&self) {
        let _ = self.tx.send(Cmd::Reconnect);
    }

    pub async fn reviews(&self) -> Vec<ReviewInfo> {
        let (reply, rx) = oneshot::channel();
        let _ = self.tx.send(Cmd::Reviews { reply });
        rx.await.unwrap_or_default()
    }

    pub async fn versions(&self, id: &str) -> Result<Versions, Error> {
        let (reply, rx) = oneshot::channel();
        self.tx
            .send(Cmd::Versions {
                id: id.into(),
                reply,
            })
            .map_err(|_| Error::Stopped)?;
        rx.await.map_err(|_| Error::Stopped)?
    }

    /// Clears a review, first saving `text` as the note if given.
    pub async fn resolve(&self, id: &str, text: Option<String>) -> Result<(), Error> {
        let (reply, rx) = oneshot::channel();
        self.tx
            .send(Cmd::Resolve {
                id: id.into(),
                text,
                reply,
            })
            .map_err(|_| Error::Stopped)?;
        rx.await.map_err(|_| Error::Stopped)?
    }

    /// Saves and stops.
    pub async fn stop(&self) {
        let (done, rx) = oneshot::channel();
        if self.tx.send(Cmd::Stop { done }).is_ok() {
            let _ = rx.await;
        }
    }
}

struct Actor {
    link: Link,
    server: Server,
    tokens: Arc<dyn TokenSource>,
    token: Option<(Option<String>, Instant)>,
    store: Store,
    vault: Vault,
    session: Session,
    dir: VaultDir,
    /// What each open editor holds, as a copy of its note: saves are diffed
    /// against it and merged into the real note as concurrent edits.
    replicas: HashMap<String, NoteDoc>,
    uploaded: HashSet<String>,
    new_uploads: Vec<String>,
    fetching: HashSet<String>,
    dirty: BTreeSet<DocKey>,
    status: watch::Sender<Status>,
    reviews: watch::Sender<u64>,
    tx: mpsc::UnboundedSender<Cmd>,
    backoff: Duration,
    reconnect_at: Option<Instant>,
    /// When the socket last opened: a token expiring soon after means
    /// something's off, so that reconnect backs off instead.
    connected_at: Option<Instant>,
    save_at: Option<Instant>,
    settle_at: Option<Instant>,
}

async fn until(at: Option<Instant>) {
    match at {
        Some(at) => tokio::time::sleep_until(at).await,
        None => std::future::pending().await,
    }
}

async fn next(
    socket: &mut Option<Socket>,
) -> Option<Result<Message, tokio_tungstenite::tungstenite::Error>> {
    match socket.as_mut() {
        Some(s) => s.next().await,
        None => std::future::pending().await,
    }
}

impl Actor {
    async fn run(mut self, mut rx: mpsc::UnboundedReceiver<Cmd>) {
        let tx = self.tx.clone();
        let _watcher = solstice_sync_fs::watch(self.dir.root(), move || {
            let _ = tx.send(Cmd::FolderChanged);
        })
        .map_err(|e| tracing::warn!(error = %e, "can't watch the folder"))
        .ok();

        // Whatever changed in the folder while the app was closed.
        let mut socket: Option<Socket> = None;
        self.absorb(&mut socket).await;

        let stopped = loop {
            tokio::select! {
                cmd = rx.recv() => match cmd {
                    None => break None,
                    Some(Cmd::Stop { done }) => break Some(done),
                    Some(cmd) => self.handle(cmd, &mut socket).await,
                },
                msg = next(&mut socket) => self.incoming(msg, &mut socket).await,
                _ = until(self.reconnect_at) => self.connect(&mut socket).await,
                _ = until(self.save_at) => self.save().await,
                _ = until(self.settle_at) => {
                    self.settle_at = None;
                    if socket.is_some() {
                        self.set_status(Status::Synced);
                    }
                }
            }
        };
        self.save().await;
        if let Some(mut s) = socket.take() {
            let _ = s.close(None).await;
        }
        // Let go of the folder and its database before saying we stopped,
        // so the caller can unlink (Windows won't delete open files).
        drop(self);
        if let Some(done) = stopped {
            let _ = done.send(());
        }
    }

    fn set_status(&self, status: Status) {
        self.status.send_if_modified(|s| {
            let changed = *s != status;
            *s = status;
            changed
        });
    }

    fn bump_reviews(&self) {
        self.reviews.send_modify(|n| *n += 1);
    }

    async fn token(&mut self) -> Result<Option<String>, Error> {
        if let Some((token, at)) = &self.token {
            if at.elapsed() < TOKEN_AGE {
                return Ok(token.clone());
            }
        }
        let token = self.tokens.token().await.map_err(Error::Network)?;
        self.token = Some((token.clone(), Instant::now()));
        Ok(token)
    }

    fn retry_later(&mut self, message: String) {
        self.set_status(Status::Offline { message });
        self.reconnect_at = Some(Instant::now() + self.backoff);
        self.backoff = (self.backoff * 2).min(MAX_BACKOFF);
    }

    async fn connect(&mut self, socket: &mut Option<Socket>) {
        self.reconnect_at = None;
        if socket.is_some() {
            return;
        }
        self.set_status(Status::Connecting);
        self.token = None;
        let token = match self.token().await {
            Ok(t) => t,
            Err(e) => return self.retry_later(e.to_string()),
        };
        match self.server.connect(token.as_deref()).await {
            Ok(s) => {
                *socket = Some(s);
                self.connected_at = Some(Instant::now());
                self.backoff = Duration::from_secs(1);
                self.set_status(Status::Syncing);
                if let Err(e) = self.upload_blobs().await {
                    tracing::warn!(error = %e, "can't upload attachments yet");
                }
                let open = self.session.open(&self.vault);
                self.send(socket, open).await;
                self.settle_at = Some(Instant::now() + SETTLE);
            }
            Err(Error::SignedOut) => self.set_status(Status::SignedOut),
            Err(e) => self.retry_later(e.to_string()),
        }
    }

    async fn send(&mut self, socket: &mut Option<Socket>, msgs: Vec<Msg>) {
        if msgs.is_empty() {
            return;
        }
        let Some(s) = socket.as_mut() else { return };
        let frame = Frame::new(&self.link.vault_id, msgs).encode();
        if s.send(Message::Binary(frame.into())).await.is_err() {
            *socket = None;
            self.retry_later("the connection dropped".into());
        }
    }

    async fn incoming(
        &mut self,
        msg: Option<Result<Message, tokio_tungstenite::tungstenite::Error>>,
        socket: &mut Option<Socket>,
    ) {
        let msg = match msg {
            Some(Ok(m)) => m,
            Some(Err(e)) => {
                *socket = None;
                return self.retry_later(e.to_string());
            }
            None => {
                *socket = None;
                return self.retry_later("the server closed the connection".into());
            }
        };
        match msg {
            Message::Binary(bytes) => {
                let frame = match Frame::decode(&bytes) {
                    Ok(f) => f,
                    Err(e) => return tracing::warn!(error = %e, "bad frame from the server"),
                };
                let mut replies = Vec::new();
                let mut relink = false;
                for msg in frame.msgs {
                    match self.session.receive(&mut self.vault, msg) {
                        Ok(out) => {
                            replies.extend(out.replies);
                            for event in out.events {
                                match event {
                                    Event::Changed(doc) => {
                                        if let DocKey::Note(id) = &doc {
                                            // A reset note's history no longer matches
                                            // an editor copy made from the old one.
                                            let epoch = self.vault.note(id).map(|n| n.epoch);
                                            if self.replicas.get(id).map(|r| r.epoch) != epoch {
                                                self.replicas.remove(id);
                                            }
                                        }
                                        self.dirty.insert(doc);
                                    }
                                    Event::Review(_) => self.bump_reviews(),
                                    Event::Relink => relink = true,
                                    Event::Forward(_) => {}
                                }
                            }
                        }
                        Err(e) => {
                            tracing::warn!(error = %e, "can't apply a change from the server")
                        }
                    }
                }
                if relink {
                    return self.relink(socket);
                }
                // Replies include changes of our own (restores, kept copies).
                self.dirty.extend(replies.iter().map(|m| m.doc.clone()));
                self.fetch_blobs();
                self.write_out();
                if !replies.is_empty() {
                    let _ = self.upload_blobs().await;
                }
                self.send(socket, replies).await;
                self.bump_reviews();
                self.schedule_save();
                if *self.status.borrow() == Status::Syncing {
                    self.settle_at = Some(Instant::now() + SETTLE);
                }
            }
            Message::Text(text) => {
                let notice: serde_json::Value = serde_json::from_str(&text).unwrap_or_default();
                match notice["notice"].as_str() {
                    Some("unknown_vault") => self.relink(socket),
                    // The connection lasts as long as its token: reconnect
                    // now, with a fresh one.
                    Some("token_expired") => {
                        *socket = None;
                        let fresh = self
                            .connected_at
                            .is_some_and(|at| at.elapsed() < Duration::from_secs(30));
                        self.reconnect_at = Some(if fresh {
                            self.set_status(Status::Offline {
                                message: "the sign-in expired straight away".into(),
                            });
                            Instant::now() + Duration::from_secs(30)
                        } else {
                            Instant::now()
                        });
                    }
                    other => tracing::warn!(notice = ?other, "notice from the sync server"),
                }
            }
            Message::Close(_) => {
                *socket = None;
                self.retry_later("the server closed the connection".into());
            }
            _ => {}
        }
    }

    fn relink(&mut self, socket: &mut Option<Socket>) {
        *socket = None;
        self.reconnect_at = None;
        self.set_status(Status::Relink);
    }

    async fn handle(&mut self, cmd: Cmd, socket: &mut Option<Socket>) {
        match cmd {
            Cmd::EditorOpened { rel, text } => {
                // Bring in anything the folder has first, so the copy matches.
                self.absorb(socket).await;
                let Some(id) = self.note_id(&rel) else { return };
                let Some(note) = self.vault.note(&id) else {
                    return;
                };
                match NoteDoc::load(&note.encode_state(), note.epoch) {
                    Ok(copy) => {
                        if copy.text() != text {
                            let _ = copy.apply_save(&text, None);
                        }
                        self.replicas.insert(id, copy);
                    }
                    Err(e) => tracing::warn!(error = %e, "can't copy a note for its editor"),
                }
            }
            Cmd::Saved { rel, text } => {
                let _ = self.dir.refresh(&rel);
                let id = self.note_id(&rel);
                let update = match id
                    .as_ref()
                    .and_then(|id| self.replicas.get(id).map(|r| (id, r)))
                {
                    Some((id, copy)) => match copy.apply_save(&text, None) {
                        Ok(Some(u)) => Some((id.clone(), u)),
                        Ok(None) => return,
                        Err(e) => return tracing::warn!(error = %e, "can't apply an editor save"),
                    },
                    // Not from a tracked editor: like any other file change.
                    None => None,
                };
                match update {
                    Some((id, update)) => {
                        let Some(note) = self.vault.note(&id) else {
                            return;
                        };
                        let epoch = note.epoch;
                        if let Err(e) = note.apply_update(&update) {
                            return tracing::warn!(error = %e, "can't merge an editor save");
                        }
                        let msg = Msg {
                            doc: DocKey::Note(id),
                            epoch,
                            body: solstice_sync::Body::Update { update },
                        };
                        self.local(socket, vec![msg]).await;
                    }
                    None => self.absorb(socket).await,
                }
            }
            Cmd::FolderChanged => self.absorb(socket).await,
            Cmd::Reconnect => {
                if socket.is_none() && *self.status.borrow() != Status::Relink {
                    self.backoff = Duration::from_secs(1);
                    self.reconnect_at = Some(Instant::now());
                }
            }
            Cmd::Reviews { reply } => {
                let _ = reply.send(self.review_list());
            }
            Cmd::Versions { id, reply } => {
                let _ = reply.send(self.versions(&id));
            }
            Cmd::Resolve { id, text, reply } => {
                let mut msgs = Vec::new();
                if let Some(text) = text {
                    match self.vault.save_note(&id, &text, None) {
                        Ok(m) => msgs.extend(m),
                        Err(e) => {
                            let _ = reply.send(Err(e.into()));
                            return;
                        }
                    }
                    // The editor reloads the resolved text.
                    self.replicas.remove(&id);
                }
                msgs.extend(self.vault.resolve_review(&id));
                self.local(socket, msgs).await;
                self.bump_reviews();
                let _ = reply.send(Ok(()));
            }
            Cmd::BlobFetched { hash, result } => {
                self.fetching.remove(&hash);
                match result.and_then(|bytes| self.dir.put_blob(&bytes).map_err(Error::io)) {
                    Ok(_) => self.write_out(),
                    Err(e) => tracing::warn!(error = %e, "can't download an attachment"),
                }
            }
            Cmd::Stop { .. } => unreachable!("handled by run"),
        }
    }

    fn note_id(&self, rel: &str) -> Option<String> {
        let id = self.vault.id_at(rel)?;
        (self.vault.manifest.entry(&id)?.kind == Kind::Note).then_some(id)
    }

    async fn absorb(&mut self, socket: &mut Option<Socket>) {
        match self.dir.absorb(&mut self.vault) {
            Ok(msgs) => self.local(socket, msgs).await,
            Err(e) => tracing::warn!(error = %e, "can't read the folder"),
        }
    }

    /// Changes made here: write them out, and send them if connected (if
    /// not, they wait in the documents for the next connect).
    async fn local(&mut self, socket: &mut Option<Socket>, msgs: Vec<Msg>) {
        if msgs.is_empty() {
            return;
        }
        self.dirty.extend(msgs.iter().map(|m| m.doc.clone()));
        self.write_out();
        self.schedule_save();
        if socket.is_some() {
            if let Err(e) = self.upload_blobs().await {
                tracing::warn!(error = %e, "can't upload attachments yet");
            }
            self.send(socket, msgs).await;
        }
    }

    fn write_out(&mut self) {
        if let Err(e) = self.dir.materialize(&self.vault) {
            tracing::warn!(error = %e, "can't write the folder");
        }
    }

    fn schedule_save(&mut self) {
        if self.save_at.is_none() {
            self.save_at = Some(Instant::now() + SAVE_AFTER);
        }
    }

    /// Uploads attachments the server may not have, before the manifest
    /// that names them reaches it.
    async fn upload_blobs(&mut self) -> Result<(), Error> {
        let wanted: Vec<String> = self
            .vault
            .manifest
            .entries()
            .into_values()
            .filter(|e| e.is_live() && e.kind == Kind::Blob)
            .filter_map(|e| e.hash)
            .filter(|h| !self.uploaded.contains(h))
            .collect();
        if wanted.is_empty() {
            return Ok(());
        }
        let token = self.token().await?;
        for hash in wanted {
            let Some(bytes) = self.dir.get_blob(&hash) else {
                continue;
            };
            self.server
                .put_blob(token.as_deref(), &self.link.vault_id, &hash, bytes)
                .await?;
            self.uploaded.insert(hash.clone());
            self.new_uploads.push(hash);
        }
        self.schedule_save();
        Ok(())
    }

    /// Downloads attachments the vault names and this device doesn't have.
    fn fetch_blobs(&mut self) {
        let missing: Vec<String> = self
            .vault
            .files()
            .into_values()
            .filter_map(|(_, c)| match c {
                Content::Blob(h) => Some(h),
                Content::Note(_) => None,
            })
            .filter(|h| !self.fetching.contains(h) && self.dir.get_blob(h).is_none())
            .collect();
        for hash in missing {
            self.fetching.insert(hash.clone());
            let (server, tokens, tx, vault) = (
                self.server.clone(),
                self.tokens.clone(),
                self.tx.clone(),
                self.link.vault_id.clone(),
            );
            tokio::spawn(async move {
                let result = match tokens.token().await {
                    Ok(token) => server.get_blob(token.as_deref(), &vault, &hash).await,
                    Err(e) => Err(Error::Network(e)),
                };
                let _ = tx.send(Cmd::BlobFetched { hash, result });
            });
        }
    }

    async fn save(&mut self) {
        self.save_at = None;
        let docs: Vec<(DocKey, u32, Vec<u8>)> = std::mem::take(&mut self.dirty)
            .into_iter()
            .filter_map(|key| match &key {
                DocKey::Manifest => Some((
                    key.clone(),
                    self.vault.manifest.epoch,
                    self.vault.manifest.encode_state(),
                )),
                DocKey::Note(id) => {
                    let note = self.vault.note(id)?;
                    Some((key.clone(), note.epoch, note.encode_state()))
                }
            })
            .collect();
        let seen = self.session.export_seen();
        let uploaded = std::mem::take(&mut self.new_uploads);
        let placed = self.dir.placed().cloned();
        let store = self.store.clone();
        let result =
            tokio::task::spawn_blocking(move || store.save(docs, seen, uploaded, placed.as_ref()))
                .await;
        match result {
            Ok(Ok(())) => {}
            Ok(Err(e)) => tracing::error!(error = %e, "can't save sync state"),
            Err(e) => tracing::error!(error = %e, "can't save sync state"),
        }
    }

    fn review_list(&self) -> Vec<ReviewInfo> {
        let paths: HashMap<String, String> = self
            .vault
            .manifest
            .materialize()
            .into_iter()
            .map(|(path, id)| (id, path))
            .collect();
        self.vault
            .manifest
            .reviews()
            .into_iter()
            .map(|(id, r)| ReviewInfo {
                path: paths.get(&id).cloned(),
                kind: match r.kind {
                    ReviewKind::Overlap => "overlap".into(),
                    ReviewKind::Restored => "restored".into(),
                },
                at: r.at,
                device: r.device,
                id,
            })
            .collect()
    }

    fn versions(&self, id: &str) -> Result<Versions, Error> {
        let review = self
            .vault
            .manifest
            .reviews()
            .remove(id)
            .ok_or_else(|| Error::NotFound("no such review".into()))?;
        let note = self
            .vault
            .note(id)
            .ok_or_else(|| Error::NotFound("no such note".into()))?;
        let at = |bytes: &Option<Vec<u8>>| -> Result<Option<String>, Error> {
            match bytes {
                Some(b) => Ok(Some(note.text_at(&decode_snapshot(b)?)?)),
                None => Ok(None),
            }
        };
        Ok(Versions {
            base: at(&review.base)?,
            local: at(&review.local)?,
            remote: at(&review.remote)?,
            merged: note.text(),
        })
    }
}
