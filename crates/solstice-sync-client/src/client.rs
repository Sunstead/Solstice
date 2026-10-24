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
    Session, TreeMeta, TreeOp, Vault,
};
use solstice_sync_fs::VaultDir;
use tokio::sync::{mpsc, oneshot, watch};
use tokio::time::Instant;
use tokio_tungstenite::tungstenite::Message;

use crate::net::{Server, Socket, TokenSource};
use crate::store::{key_from_name, Link, Store, OWN};
use crate::throttle::Throttle;
use crate::tree_file;
use crate::Error;

const SAVE_AFTER: Duration = Duration::from_secs(2);
/// Quiet this long after connecting means synced.
const SETTLE: Duration = Duration::from_millis(800);
const MAX_BACKOFF: Duration = Duration::from_secs(60);
/// Attachments downloaded at once. Each is a connection, and a phone has
/// few file descriptors to spare.
const MAX_FETCHES: usize = 4;
/// A download that failed is tried again after this, doubling up to the
/// maximum while it keeps failing.
const FETCH_RETRY: Duration = Duration::from_secs(5);
const MAX_FETCH_RETRY: Duration = Duration::from_secs(5 * 60);
/// Writing the folder out failed (out of file descriptors, say): try again
/// after this, doubling up to the maximum.
const WRITE_RETRY: Duration = Duration::from_secs(5);
const MAX_WRITE_RETRY: Duration = Duration::from_secs(5 * 60);
/// Access tokens are refreshed when older than this (Authentik's last 10
/// minutes; the WebSocket only needs one at connect).
const TOKEN_AGE: Duration = Duration::from_secs(4 * 60);
/// While an editor keeps saving (a drawing or PDF drawn on), the folder is
/// looked at, and what changed uploaded, at most this often (`Throttle`).
const EDITOR_EVERY: Duration = Duration::from_secs(30);

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
    /// The vault was rebuilt on the server: link again.
    Relink,
    /// The vault was deleted on the server. This folder keeps its files and
    /// stops syncing; unlink it, or link it to another vault.
    Deleted,
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
    EditorWrote {
        /// Look now, not after a while (the editor was left).
        now: bool,
    },
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
    ApplyTreeMeta {
        ops: Vec<TreeOp>,
        reply: oneshot::Sender<Result<TreeMeta, Error>>,
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
    tree_meta: watch::Receiver<TreeMeta>,
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
        if let Err(e) = dir.clear_tmp() {
            tracing::warn!(error = %e, "can't clear the folder's temporary files");
        }
        if let Some(placed) = saved.placed {
            dir.set_placed(placed);
        }

        let (tx, rx) = mpsc::unbounded_channel();
        let (status_tx, status) = watch::channel(Status::Connecting);
        let (reviews_tx, reviews) = watch::channel(0u64);
        let (tree_meta_tx, tree_meta) = watch::channel(vault.tree_meta());
        let last_meta = tree_file::read(&root);
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
            fetch_failed: HashMap::new(),
            dirty: BTreeSet::new(),
            status: status_tx,
            reviews: reviews_tx,
            tree_meta: tree_meta_tx,
            last_meta,
            tx: tx.clone(),
            backoff: Duration::from_secs(1),
            reconnect_at: Some(Instant::now()),
            connected_at: None,
            save_at: None,
            settle_at: None,
            editor: Throttle::new(SETTLE, EDITOR_EVERY),
            fetch_at: None,
            write_at: None,
            write_backoff: WRITE_RETRY,
        };
        tokio::spawn(actor.run(rx));
        Ok(Client {
            tx,
            status,
            reviews,
            tree_meta,
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

    /// Changes whenever the bookmarks or folder colors do, here or
    /// elsewhere.
    pub fn watch_tree_meta(&self) -> watch::Receiver<TreeMeta> {
        self.tree_meta.clone()
    }

    /// The bookmarks and folder colors now. Never waits on the sync loop,
    /// which reads the whole folder before it answers anything.
    pub fn tree_meta(&self) -> TreeMeta {
        self.tree_meta.borrow().clone()
    }

    /// Changes the bookmarks or folder colors, and returns them after.
    pub async fn apply_tree_meta(&self, ops: Vec<TreeOp>) -> Result<TreeMeta, Error> {
        let (reply, rx) = oneshot::channel();
        self.tx
            .send(Cmd::ApplyTreeMeta { ops, reply })
            .map_err(|_| Error::Stopped)?;
        rx.await.map_err(|_| Error::Stopped)?
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

    /// A file in the folder changed and the caller knows it: sync it now,
    /// not when the watcher notices.
    pub fn folder_changed(&self) {
        let _ = self.tx.send(Cmd::FolderChanged);
    }

    /// An editor that saves the file itself (the iOS app's PDFs and
    /// drawings) wrote it: sync it soon, and while it keeps saving, at most
    /// every 30 seconds, since each sync reads and uploads the whole file.
    /// `now` when the editor was left: sync it at once.
    pub fn editor_wrote(&self, now: bool) {
        let _ = self.tx.send(Cmd::EditorWrote { now });
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
    /// Downloads in flight.
    fetching: HashSet<String>,
    /// Downloads that failed: when to try each again, and the wait after that.
    fetch_failed: HashMap<String, (Instant, Duration)>,
    dirty: BTreeSet<DocKey>,
    status: watch::Sender<Status>,
    reviews: watch::Sender<u64>,
    /// The vault's tree meta, for [`Client::tree_meta`].
    tree_meta: watch::Sender<TreeMeta>,
    /// The tree meta last mirrored to `.solstice/tree.json`.
    last_meta: TreeMeta,
    tx: mpsc::UnboundedSender<Cmd>,
    backoff: Duration,
    reconnect_at: Option<Instant>,
    /// When the socket last opened: a token expiring soon after means
    /// something's off, so that reconnect backs off instead.
    connected_at: Option<Instant>,
    save_at: Option<Instant>,
    settle_at: Option<Instant>,
    /// When to look at the folder after an editor wrote to it.
    editor: Throttle,
    /// Downloads that failed are tried again then.
    fetch_at: Option<Instant>,
    /// Writing the folder out failed: it's tried again then.
    write_at: Option<Instant>,
    write_backoff: Duration,
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
        // On iOS, notify watches with kqueue, which holds a file descriptor
        // for every file and folder: a vault of any size runs the app out of
        // them (os error 24). The app polls the folder there instead, and
        // calls [`Client::folder_changed`].
        #[cfg(not(target_os = "ios"))]
        let _watcher = {
            let tx = self.tx.clone();
            solstice_sync_fs::watch(self.dir.root(), move || {
                let _ = tx.send(Cmd::FolderChanged);
            })
            .map_err(|e| tracing::warn!(error = %e, "can't watch the folder"))
            .ok()
        };

        // Whatever changed in the folder while the app was closed.
        let mut socket: Option<Socket> = None;
        self.absorb(&mut socket).await;
        self.meta_changed();
        // Cached attachments from before they were pruned as they synced.
        self.prune_blobs();

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
                _ = until(self.fetch_at) => {
                    self.fetch_at = None;
                    self.fetch_blobs();
                }
                _ = until(self.write_at) => {
                    self.write_at = None;
                    self.write_out();
                }
                _ = until(self.editor.due()) => self.absorb(&mut socket).await,
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

    /// Mirrors the bookmarks and folder colors to the folder, and says so,
    /// if they changed. Unlike reviews, only on a real change: the frontend
    /// reloads on every bump.
    fn meta_changed(&mut self) {
        let now = self.vault.tree_meta();
        if now == self.last_meta {
            return;
        }
        if let Err(e) = tree_file::write(self.dir.root(), &now) {
            tracing::warn!(error = %e, "can't write the folder's tree.json");
        }
        self.tree_meta.send_replace(now.clone());
        self.last_meta = now;
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
                // Back online: downloads that failed meanwhile go again now.
                let now = Instant::now();
                for (at, _) in self.fetch_failed.values_mut() {
                    *at = now;
                }
                self.set_status(Status::Syncing);
                if !self.uploaded_or_retry(socket).await {
                    return;
                }
                let open = self.session.open(&self.vault);
                self.send(socket, open).await;
                self.settle_at = Some(Instant::now() + SETTLE);
            }
            // A token the server turned down (stale, or its clock runs ahead)
            // isn't a sign-out: only the provider revoking the sign-in is,
            // and then there's no token at all.
            Err(Error::SignedOut) if token.is_some() => {
                if let Some(t) = &token {
                    self.tokens.refused(t).await;
                }
                self.retry_later("the server turned the sign-in down".into());
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
                    return self.stop_syncing(socket, Status::Relink);
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
                self.meta_changed();
                self.schedule_save();
                if *self.status.borrow() == Status::Syncing {
                    self.settle_at = Some(Instant::now() + SETTLE);
                }
            }
            Message::Text(text) => {
                let notice: serde_json::Value = serde_json::from_str(&text).unwrap_or_default();
                match notice["notice"].as_str() {
                    Some("unknown_vault") => self.stop_syncing(socket, Status::Relink),
                    Some("vault_deleted") => self.stop_syncing(socket, Status::Deleted),
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

    /// Stops for good: only linking again (or unlinking) moves on from here.
    fn stop_syncing(&mut self, socket: &mut Option<Socket>, status: Status) {
        *socket = None;
        self.reconnect_at = None;
        self.set_status(status);
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
            Cmd::EditorWrote { now } => self.editor.changed(Instant::now(), now),
            Cmd::Reconnect => {
                let stopped = matches!(*self.status.borrow(), Status::Relink | Status::Deleted);
                if socket.is_none() && !stopped {
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
            Cmd::ApplyTreeMeta { ops, reply } => match self.vault.apply_tree_ops(&ops) {
                Ok(msgs) => {
                    self.local(socket, msgs).await;
                    let _ = reply.send(Ok(self.vault.tree_meta()));
                }
                Err(e) => {
                    let _ = reply.send(Err(e.into()));
                }
            },
            Cmd::BlobFetched { hash, result } => {
                self.fetching.remove(&hash);
                match result.and_then(|bytes| self.dir.put_blob(&bytes).map_err(Error::io)) {
                    Ok(_) => {
                        self.fetch_failed.remove(&hash);
                        // It came from the server, so it never needs uploading,
                        // and its cached copy can go once it's in its file.
                        if self.uploaded.insert(hash.clone()) {
                            self.new_uploads.push(hash);
                        }
                        self.write_out();
                        // Saved soon, with where the file was written: else a
                        // restart would take it for a new file made here.
                        self.schedule_save();
                    }
                    Err(e) => {
                        tracing::warn!(error = %e, "can't download an attachment");
                        let wait = self
                            .fetch_failed
                            .get(&hash)
                            .map_or(FETCH_RETRY, |(_, wait)| (*wait * 2).min(MAX_FETCH_RETRY));
                        self.fetch_failed
                            .insert(hash, (Instant::now() + wait, wait));
                    }
                }
                self.fetch_blobs();
            }
            Cmd::Stop { .. } => unreachable!("handled by run"),
        }
    }

    fn note_id(&self, rel: &str) -> Option<String> {
        let id = self.vault.id_at(rel)?;
        (self.vault.manifest.entry(&id)?.kind == Kind::Note).then_some(id)
    }

    async fn absorb(&mut self, socket: &mut Option<Socket>) {
        // Whatever an editor wrote is taken in now too.
        self.editor.fired(Instant::now());
        match self.dir.absorb(&mut self.vault) {
            Ok(msgs) => {
                if self.dir.write_pending() {
                    self.write_later();
                }
                self.local(socket, msgs).await
            }
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
        self.meta_changed();
        self.write_out();
        self.schedule_save();
        if socket.is_some() && self.uploaded_or_retry(socket).await {
            self.send(socket, msgs).await;
        }
    }

    /// Uploads the attachments the vault names, so no device hears of a file
    /// the server can't give it. If the network fails, the connection is
    /// dropped and the changes go with the next one. The server refusing one
    /// (too big, say) doesn't hold up the rest of the vault.
    async fn uploaded_or_retry(&mut self, socket: &mut Option<Socket>) -> bool {
        match self.upload_blobs().await {
            Ok(()) => true,
            Err(e @ (Error::Network(_) | Error::SignedOut)) => {
                tracing::warn!(error = %e, "can't upload attachments yet");
                if let Some(mut s) = socket.take() {
                    let _ = s.close(None).await;
                }
                self.retry_later(e.to_string());
                false
            }
            Err(e) => {
                tracing::warn!(error = %e, "the server refused an attachment");
                true
            }
        }
    }

    fn write_out(&mut self) {
        match self.dir.materialize(&self.vault) {
            Ok(()) => {
                self.write_at = None;
                self.write_backoff = WRITE_RETRY;
            }
            Err(e) => {
                tracing::warn!(error = %e, "can't write the folder");
                self.write_later();
            }
        }
    }

    /// Tries writing the folder out again later, waiting longer each time.
    fn write_later(&mut self) {
        if self.write_at.is_none() {
            self.write_at = Some(Instant::now() + self.write_backoff);
            self.write_backoff = (self.write_backoff * 2).min(MAX_WRITE_RETRY);
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

    /// Downloads attachments the vault names and this device doesn't have, a
    /// few at a time: each finished download starts the next. One that
    /// failed waits its turn to be tried again.
    fn fetch_blobs(&mut self) {
        let room = MAX_FETCHES.saturating_sub(self.fetching.len());
        if room == 0 {
            return;
        }
        let now = Instant::now();
        let mut retry_at: Option<Instant> = None;
        let mut missing: Vec<String> = Vec::new();
        let wanted: BTreeSet<String> = self
            .vault
            .files()
            .into_values()
            .filter_map(|(_, c)| match c {
                Content::Blob(h) => Some(h),
                Content::Note(_) => None,
            })
            .filter(|h| !self.fetching.contains(h) && !self.dir.has_blob(h))
            .collect();
        // Failures of blobs the vault no longer names are forgotten.
        self.fetch_failed.retain(|h, _| wanted.contains(h));
        for hash in wanted {
            match self.fetch_failed.get(&hash) {
                Some((at, _)) if *at > now => {
                    retry_at = Some(retry_at.map_or(*at, |r| r.min(*at)));
                }
                _ if missing.len() < room => missing.push(hash),
                _ => {}
            }
        }
        if let Some(at) = retry_at {
            self.fetch_at = Some(self.fetch_at.map_or(at, |f| f.min(at)));
        }
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
            Ok(Ok(())) => {
                self.prune_blobs();
            }
            Ok(Err(e)) => tracing::error!(error = %e, "can't save sync state"),
            Err(e) => tracing::error!(error = %e, "can't save sync state"),
        }
    }

    /// Drops the cached copies of attachments that are in their files and
    /// saved as on the server: they can be fetched again if ever needed.
    fn prune_blobs(&self) {
        let uploaded = &self.uploaded;
        let pruned = self.dir.prune_blobs(&self.vault, |h| uploaded.contains(h));
        if pruned > 0 {
            tracing::debug!(pruned, "dropped cached attachments");
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
