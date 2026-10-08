//! One task per vault in use. It owns the vault's Yjs state (the engine's
//! [`Vault`]), its folder, and the sessions of the devices connected to it:
//!
//! - Device frames go through that connection's server-side [`Session`];
//!   replies go back to it and updates go on to the vault's other devices.
//! - Changes are written to the folder at once, and the state saved to the
//!   database a moment later. Files first: after a crash the folder is never
//!   behind the database, so "the folder wins" at startup is always safe.
//!   State lost in that moment heals itself, since devices keep full history
//!   and resend whatever the server is missing.
//! - A watcher turns edits made in the folder into changes for devices.
//! - The web app's reads and saves run here too (`web.rs`), and web apps
//!   watching the vault hear what changed.
//!
//! A vault's task stops after a while with no connections and starts again
//! on demand.

use std::collections::{BTreeSet, HashMap};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use solstice_sync::{DocKey, Event, Frame, Manifest, Msg, NoteDoc, Session, Vault};
use tokio::sync::{mpsc, oneshot};

use crate::db::{now, Db, DbError, DocRow, VaultRow};
use crate::error::AppError;
use solstice_sync_fs::VaultDir;

mod web;
pub use web::{checked as checked_path, WebOp, WebReply};

const SAVE_AFTER: Duration = Duration::from_secs(2);
const IDLE_AFTER: Duration = Duration::from_secs(10 * 60);
const MANIFEST: &str = "manifest";

/// What a connection's writer sends to its device.
#[derive(Debug, Clone)]
pub enum Outgoing {
    /// An encoded [`Frame`].
    Frame(Vec<u8>),
    /// A JSON notice, e.g. an unknown vault.
    Notice(String),
}

pub type ConnId = u64;

pub enum Cmd {
    Connect {
        conn: ConnId,
        tx: mpsc::UnboundedSender<Outgoing>,
    },
    Disconnect {
        conn: ConnId,
    },
    Frame {
        conn: ConnId,
        msgs: Vec<Msg>,
    },
    CreateNote {
        path: String,
        text: String,
        reply: oneshot::Sender<Result<(String, String), String>>,
    },
    PutBlob {
        bytes: Vec<u8>,
        reply: oneshot::Sender<Result<String, String>>,
    },
    GetBlob {
        hash: String,
        reply: oneshot::Sender<Option<Vec<u8>>>,
    },
    FolderChanged,
    /// Something the web app asked for.
    Web {
        op: WebOp,
        reply: oneshot::Sender<Result<WebReply, AppError>>,
    },
    /// A web app watching the vault: each change is sent to it as JSON
    /// (`{"tree": bool, "notes": [path]}`).
    Watch {
        tx: mpsc::UnboundedSender<String>,
    },
    /// Save and stop (server shutdown).
    Stop {
        done: oneshot::Sender<()>,
    },
    /// The vault is being deleted: tell everyone connected, and stop without
    /// saving.
    Delete {
        done: oneshot::Sender<()>,
    },
}

/// What [`Hub::send`] says about a vault deleted since its row was read.
pub const DELETED: &str = "the vault was deleted";

#[derive(Clone)]
pub struct Hub {
    db: Db,
    notes_dir: PathBuf,
    running: Arc<Mutex<HashMap<String, mpsc::UnboundedSender<Cmd>>>>,
    /// Held while a vault loads. Two loads of one vault would each absorb its
    /// folder as new, minting different ids for the same files, and both save
    /// their state: the vault would then be served by one and stored as the
    /// other. Loads are rare, so one at a time is plenty.
    loading: Arc<tokio::sync::Mutex<()>>,
}

impl Hub {
    pub fn new(db: Db, notes_dir: PathBuf) -> Self {
        Self {
            db,
            notes_dir,
            running: Arc::default(),
            loading: Arc::default(),
        }
    }

    fn running_task(&self, vault: &str) -> Option<mpsc::UnboundedSender<Cmd>> {
        self.running
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .get(vault)
            .filter(|tx| !tx.is_closed())
            .cloned()
    }

    pub fn folder(&self, username: &str, vault: &str) -> PathBuf {
        self.notes_dir.join(username).join(vault)
    }

    /// Sends to a vault's task, starting it if needed.
    pub async fn send(&self, vault: &VaultRow, username: &str, cmd: Cmd) -> Result<(), String> {
        let mut cmd = cmd;
        for _ in 0..2 {
            let tx = self.task(vault, username).await?;
            match tx.send(cmd) {
                Ok(()) => return Ok(()),
                // It stopped between lookup and send: start it again.
                Err(mpsc::error::SendError(back)) => {
                    cmd = back;
                    self.running
                        .lock()
                        .unwrap_or_else(|p| p.into_inner())
                        .remove(&vault.id);
                }
            }
        }
        Err("the vault's task isn't running".into())
    }

    async fn task(
        &self,
        vault: &VaultRow,
        username: &str,
    ) -> Result<mpsc::UnboundedSender<Cmd>, String> {
        if let Some(tx) = self.running_task(&vault.id) {
            return Ok(tx);
        }
        let _loading = self.loading.lock().await;
        // Another request may have started it while this one waited.
        if let Some(tx) = self.running_task(&vault.id) {
            return Ok(tx);
        }
        // Or deleted it: loading would make its folder again.
        if let Err(DbError::NotFound) = self.db.vault(vault.user_id, &vault.id).await {
            return Err(DELETED.into());
        }
        let state = VaultTask::load(
            self.db.clone(),
            vault.clone(),
            self.folder(username, &vault.name),
        )
        .await?;
        let (tx, rx) = mpsc::unbounded_channel();
        self.running
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .insert(vault.id.clone(), tx.clone());
        let running = self.running.clone();
        let id = vault.id.clone();
        let watch_tx = tx.clone();
        tokio::spawn(async move {
            state.run(rx, watch_tx).await;
            running
                .lock()
                .unwrap_or_else(|p| p.into_inner())
                .remove(&id);
        });
        Ok(tx)
    }

    /// Saves and stops every vault's task, for a clean shutdown.
    pub async fn shutdown(&self) {
        let senders: Vec<_> = self
            .running
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .values()
            .cloned()
            .collect();
        let mut waits = Vec::new();
        for tx in senders {
            let (done, wait) = oneshot::channel();
            if tx.send(Cmd::Stop { done }).is_ok() {
                waits.push(wait);
            }
        }
        for wait in waits {
            let _ = tokio::time::timeout(Duration::from_secs(10), wait).await;
        }
    }

    /// Deletes a vault. Its task tells connected devices and web apps and
    /// stops without saving; then its state goes, and its folder moves to the
    /// user's hidden `.trash` (which listing skips, as Atlas does), where an
    /// admin can still recover it. Returns where it went.
    pub async fn delete(&self, vault: &VaultRow, username: &str) -> Result<Option<PathBuf>, String> {
        // No vault loads while it goes, so nothing brings it back.
        let _loading = self.loading.lock().await;
        if let Some(tx) = self.running_task(&vault.id) {
            let (done, wait) = oneshot::channel();
            if tx.send(Cmd::Delete { done }).is_ok() {
                let _ = tokio::time::timeout(Duration::from_secs(10), wait).await;
            }
            self.running
                .lock()
                .unwrap_or_else(|p| p.into_inner())
                .remove(&vault.id);
        }
        self.db
            .delete_vault(vault.user_id, &vault.id)
            .await
            .map_err(|e| e.to_string())?;

        let folder = self.folder(username, &vault.name);
        if !folder.exists() {
            return Ok(None);
        }
        let trash = self.notes_dir.join(username).join(".trash");
        std::fs::create_dir_all(&trash).map_err(|e| e.to_string())?;
        let stamp = trash_stamp();
        let mut to = trash.join(format!("{} {stamp}", vault.name));
        let mut n = 2;
        while to.exists() {
            to = trash.join(format!("{} {stamp} {n}", vault.name));
            n += 1;
        }
        std::fs::rename(&folder, &to)
            .map_err(|e| format!("couldn't move {}: {e}", folder.display()))?;
        tracing::info!(vault = %vault.id, to = %to.display(), "vault deleted");
        Ok(Some(to))
    }

    /// Stops sending to a connection on every vault it used.
    pub fn disconnect(&self, conn: ConnId, vaults: &BTreeSet<String>) {
        let running = self.running.lock().unwrap_or_else(|p| p.into_inner());
        for id in vaults {
            if let Some(tx) = running.get(id) {
                let _ = tx.send(Cmd::Disconnect { conn });
            }
        }
    }
}

struct VaultTask {
    db: Db,
    row: VaultRow,
    vault: Vault,
    dir: VaultDir,
    sessions: HashMap<ConnId, (Session, mpsc::UnboundedSender<Outgoing>)>,
    watchers: Vec<mpsc::UnboundedSender<String>>,
    dirty: BTreeSet<DocKey>,
    recent_saves: web::RecentSaves,
}

impl VaultTask {
    /// Loads the vault's state and brings it in line with its folder, which
    /// wins: anything changed there while the server was down (or the state
    /// lost) becomes a change devices will receive.
    async fn load(db: Db, row: VaultRow, folder: PathBuf) -> Result<Self, String> {
        let docs = db.docs(&row.id).await.map_err(|e| e.to_string())?;
        let mut manifest = None;
        let mut notes = Vec::new();
        for doc in docs {
            if doc.doc == MANIFEST {
                manifest = Some(Manifest::load(&doc.state, doc.epoch).map_err(|e| e.to_string())?);
            } else {
                notes.push((
                    doc.doc.clone(),
                    NoteDoc::load(&doc.state, doc.epoch).map_err(|e| e.to_string())?,
                ));
            }
        }
        let mut dirty = BTreeSet::new();
        let fresh_manifest = manifest.is_none();
        let manifest = manifest.unwrap_or_else(|| {
            // No state for this vault (new, or the database was lost): a new
            // epoch, so linked devices know to link again.
            dirty.insert(DocKey::Manifest);
            Manifest::new(now() as u32)
        });
        let mut vault = Vault::load("server", manifest, notes);
        let mut dir = VaultDir::open(folder, ".solstice").map_err(|e| e.to_string())?;
        if let Some(placed) = db.placed(&row.id).await.map_err(|e| e.to_string())? {
            dir.set_placed(placed);
        }

        if !fresh_manifest {
            // Notes whose state was lost but whose file survived: rebuild
            // them under a new epoch.
            let files = vault.files();
            let missing: Vec<(String, String)> = files
                .iter()
                .filter(|(_, (id, _))| {
                    vault
                        .manifest
                        .entry(id)
                        .is_some_and(|e| e.kind == solstice_sync::Kind::Note)
                })
                .filter(|(_, (id, _))| vault.note(id).is_none())
                .filter_map(|(path, (id, _))| {
                    Some((id.clone(), String::from_utf8(dir.read(path).ok()?).ok()?))
                })
                .filter(|(_, text)| !text.is_empty())
                .collect();
            for (id, text) in missing {
                tracing::warn!(vault = %row.id, note = %id, "note state missing; rebuilding it from its file");
                vault.rebuild_note(&id, &text);
                dirty.insert(DocKey::Note(id));
            }
        }

        let msgs = dir.absorb(&mut vault).map_err(|e| e.to_string())?;
        dirty.extend(msgs.into_iter().map(|m| m.doc));
        let mut task = Self {
            db,
            row,
            vault,
            dir,
            sessions: HashMap::new(),
            watchers: Vec::new(),
            dirty,
            recent_saves: Default::default(),
        };
        task.save().await;
        Ok(task)
    }

    async fn run(mut self, mut rx: mpsc::UnboundedReceiver<Cmd>, tx: mpsc::UnboundedSender<Cmd>) {
        let watcher = watch(self.dir.root(), tx);
        let mut save_at: Option<tokio::time::Instant> = None;
        let mut idle_since = tokio::time::Instant::now();
        let mut stopped = None;
        let mut deleted = false;
        loop {
            let deadline = save_at.unwrap_or_else(|| tokio::time::Instant::now() + IDLE_AFTER);
            tokio::select! {
                cmd = rx.recv() => {
                    let Some(cmd) = cmd else { break };
                    if let Cmd::Stop { done } = cmd {
                        stopped = Some(done);
                        break;
                    }
                    if let Cmd::Delete { done } = cmd {
                        self.tell_deleted();
                        stopped = Some(done);
                        deleted = true;
                        break;
                    }
                    self.handle(cmd);
                    if !self.dirty.is_empty() && save_at.is_none() {
                        save_at = Some(tokio::time::Instant::now() + SAVE_AFTER);
                    }
                    if self.in_use() {
                        idle_since = tokio::time::Instant::now();
                    }
                }
                _ = tokio::time::sleep_until(deadline) => {
                    if save_at.take().is_some() {
                        self.save().await;
                    }
                    if !self.in_use() && idle_since.elapsed() >= IDLE_AFTER {
                        break;
                    }
                }
            }
        }
        // A deleted vault's state is about to go: saving would only bring
        // some of it back.
        if !deleted {
            self.save().await;
        }
        drop(watcher);
        tracing::debug!(vault = %self.row.id, "vault task stopped");
        if let Some(done) = stopped {
            let _ = done.send(());
        }
    }

    /// Tells every device and web app on this vault that it's gone.
    fn tell_deleted(&mut self) {
        let to_devices = notice(&self.row.id, "vault_deleted");
        for (_, tx) in self.sessions.values() {
            let _ = tx.send(Outgoing::Notice(to_devices.clone()));
        }
        let to_web = serde_json::json!({ "notice": "vault_deleted" }).to_string();
        for tx in &self.watchers {
            let _ = tx.send(to_web.clone());
        }
        self.sessions.clear();
        self.watchers.clear();
    }

    /// A device or a web app is connected.
    fn in_use(&self) -> bool {
        !self.sessions.is_empty() || self.watchers.iter().any(|w| !w.is_closed())
    }

    fn handle(&mut self, cmd: Cmd) {
        match cmd {
            Cmd::Web { op, reply } => {
                let paths: Vec<String> = op.paths().into_iter().map(str::to_owned).collect();
                self.absorb_first(&paths);
                let _ = reply.send(self.web(op));
            }
            Cmd::Watch { tx } => self.watchers.push(tx),
            Cmd::Connect { conn, tx } => {
                self.sessions
                    .entry(conn)
                    .or_insert_with(|| (Session::server(), tx));
            }
            Cmd::Disconnect { conn } => {
                self.sessions.remove(&conn);
            }
            Cmd::Frame { conn, msgs } => {
                let placed = self.dir.placed();
                let paths: Vec<String> = msgs
                    .iter()
                    .filter_map(|m| match &m.doc {
                        DocKey::Note(id) => placed?.get(id).map(|(p, _)| p.clone()),
                        DocKey::Manifest => None,
                    })
                    .collect();
                self.absorb_first(&paths);
                self.frame(conn, msgs)
            }
            Cmd::CreateNote { path, text, reply } => {
                let result = self
                    .vault
                    .create_note(&path, &text)
                    .map_err(|e| e.to_string());
                let _ = reply.send(match result {
                    Ok((id, msgs)) => {
                        self.changed(None, msgs);
                        // Where it landed: numbered if the path was taken.
                        let placed = self
                            .vault
                            .files()
                            .into_iter()
                            .find(|(_, (i, _))| *i == id)
                            .map(|(p, _)| p);
                        Ok((id, placed.unwrap_or(path)))
                    }
                    Err(e) => Err(e),
                });
            }
            Cmd::PutBlob { bytes, reply } => {
                let result = self.dir.put_blob(&bytes).map_err(|e| e.to_string());
                // Its manifest entry may have arrived first.
                self.write_out();
                let _ = reply.send(result);
            }
            Cmd::GetBlob { hash, reply } => {
                let _ = reply.send(self.dir.get_blob(&hash));
            }
            Cmd::Stop { .. } | Cmd::Delete { .. } => unreachable!("handled by run"),
            Cmd::FolderChanged => match self.dir.absorb(&mut self.vault) {
                Ok(msgs) => self.changed(None, msgs),
                Err(e) => {
                    tracing::warn!(vault = %self.row.id, error = %e, "can't read the vault folder")
                }
            },
        }
    }

    /// Folds in edits made directly in the folder that the watcher hasn't
    /// reported yet, if any of `paths` has one: a change about to be written
    /// to that file then merges with the edit instead of writing over it.
    fn absorb_first(&mut self, paths: &[String]) {
        if !paths.iter().any(|p| self.dir.changed_on_disk(p)) {
            return;
        }
        match self.dir.absorb(&mut self.vault) {
            Ok(msgs) => self.changed(None, msgs),
            Err(e) => {
                tracing::warn!(vault = %self.row.id, error = %e, "can't read the vault folder")
            }
        }
    }

    fn frame(&mut self, conn: ConnId, msgs: Vec<Msg>) {
        let Some((session, tx)) = self.sessions.get_mut(&conn) else {
            return;
        };
        let tx = tx.clone();
        let mut replies = Vec::new();
        let mut forward = Vec::new();
        for msg in msgs {
            match session.receive(&mut self.vault, msg) {
                Ok(out) => {
                    replies.extend(out.replies);
                    for event in out.events {
                        match event {
                            Event::Forward(m) => forward.push(m),
                            Event::Changed(doc) => {
                                self.dirty.insert(doc);
                            }
                            Event::Review(_) | Event::Relink => {}
                        }
                    }
                }
                Err(e) => {
                    tracing::warn!(vault = %self.row.id, error = %e, "bad message from a device");
                    let _ = tx.send(Outgoing::Notice(notice(&self.row.id, "bad_message")));
                }
            }
        }
        if !replies.is_empty() {
            let _ = tx.send(Outgoing::Frame(Frame::new(&self.row.id, replies).encode()));
        }
        self.changed(Some(conn), forward);
    }

    /// Records changes, writes the folder, and sends them to every device
    /// except `from`.
    fn changed(&mut self, from: Option<ConnId>, msgs: Vec<Msg>) {
        if msgs.is_empty() {
            return;
        }
        self.dirty.extend(msgs.iter().map(|m| m.doc.clone()));
        self.write_out();
        self.notify_msgs(&msgs);
        let bytes = Frame::new(&self.row.id, msgs).encode();
        for (conn, (_, tx)) in &self.sessions {
            if Some(*conn) != from {
                let _ = tx.send(Outgoing::Frame(bytes.clone()));
            }
        }
    }

    fn write_out(&mut self) {
        if let Err(e) = self.dir.materialize(&self.vault) {
            tracing::warn!(vault = %self.row.id, error = %e, "can't write the vault folder");
        }
    }

    async fn save(&mut self) {
        let docs: Vec<DocRow> = std::mem::take(&mut self.dirty)
            .into_iter()
            .filter_map(|key| match key {
                DocKey::Manifest => Some(DocRow {
                    doc: MANIFEST.into(),
                    epoch: self.vault.manifest.epoch,
                    state: self.vault.manifest.encode_state(),
                }),
                DocKey::Note(id) => {
                    let note = self.vault.note(&id)?;
                    Some(DocRow {
                        doc: id,
                        epoch: note.epoch,
                        state: note.encode_state(),
                    })
                }
            })
            .collect();
        if let Err(e) = self.db.save_docs(&self.row.id, docs).await {
            tracing::error!(vault = %self.row.id, error = %e, "can't save vault state");
        }
        if let Some(placed) = self.dir.placed() {
            if let Err(e) = self.db.save_placed(&self.row.id, placed).await {
                tracing::error!(vault = %self.row.id, error = %e, "can't save where vault files are");
            }
        }
    }
}

/// A sortable, filename-safe UTC time for the trash: `2026-10-05 14.03.07`.
fn trash_stamp() -> String {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    let (days, rem) = (secs.div_euclid(86_400), secs.rem_euclid(86_400));
    // The civil date from days since 1970-01-01 (Howard Hinnant's algorithm).
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + i64::from(month <= 2);
    format!(
        "{year:04}-{month:02}-{day:02} {:02}.{:02}.{:02}",
        rem / 3600,
        rem % 3600 / 60,
        rem % 60
    )
}

pub fn notice(vault: &str, code: &str) -> String {
    serde_json::json!({ "vault": vault, "notice": code }).to_string()
}

/// Pokes the task when its folder changes.
fn watch(
    root: &std::path::Path,
    tx: mpsc::UnboundedSender<Cmd>,
) -> Option<solstice_sync_fs::Watcher> {
    solstice_sync_fs::watch(root, move || {
        let _ = tx.send(Cmd::FolderChanged);
    })
    .map_err(|e| tracing::warn!(error = %e, "can't watch a vault folder"))
    .ok()
}
