//! Linking a folder to a vault, and unlinking it.

use std::path::Path;
use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use serde::Serialize;
use solstice_sync::{plan_link, Content, DocKey, Frame, LinkStep, LocalFile, Msg, Session, Vault};
use solstice_sync_fs::{Placed, VaultDir};
use tokio_tungstenite::tungstenite::Message;

use crate::net::{Server, Socket, TokenSource};
use crate::store::{is_linked, Link, Store, OWN};
use crate::Error;

/// How long the server may stay quiet before the exchange counts as done.
const QUIET: Duration = Duration::from_millis(1500);
const LINK_TIMEOUT: Duration = Duration::from_secs(300);

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
pub struct LinkReport {
    /// Files that were the same on both sides.
    pub same: usize,
    /// Files copied here from the vault.
    pub downloaded: usize,
    /// Files added to the vault from here.
    pub uploaded: usize,
    /// Files that differed: this device's version was kept beside the
    /// vault's, under these names.
    pub kept_both: Vec<String>,
}

/// Links `folder` to the vault `vault_id` on `server`. Files only on one
/// side are copied to the other; files on both with different content are
/// kept both ways (the vault's keeps the name; this device's is renamed
/// `name (this device).ext`). Afterwards, start a [`crate::Client`].
pub async fn link(
    folder: &Path,
    server_url: &str,
    vault_id: &str,
    vault_name: &str,
    device: &str,
    tokens: &dyn TokenSource,
) -> Result<LinkReport, Error> {
    if is_linked(folder) {
        return Err(Error::AlreadyLinked);
    }
    let server = Server::new(server_url)?;
    let token = tokens.token().await.map_err(Error::Network)?;
    let mut socket = server.connect(token.as_deref()).await?;

    // Everything the vault has.
    let mut vault = Vault::new(device);
    let mut session = Session::device();
    let open = session.open(&vault);
    send(&mut socket, vault_id, open).await?;
    exchange(&mut socket, vault_id, &mut vault, &mut session).await?;

    let mut dir = VaultDir::open(folder.to_path_buf(), OWN).map_err(Error::io)?;
    for (_, content) in vault.files().into_values() {
        if let Content::Blob(hash) = content {
            if dir.get_blob(&hash).is_none() {
                let bytes = server.get_blob(token.as_deref(), vault_id, &hash).await?;
                dir.put_blob(&bytes).map_err(Error::io)?;
            }
        }
    }

    // What's here, compared.
    let local: Vec<LocalFile> = dir
        .scan()
        .map_err(Error::io)?
        .into_iter()
        .map(|(path, found)| LocalFile {
            path,
            hash: found.hash,
        })
        .collect();
    let mut report = LinkReport::default();
    let mut placed = Placed::new();
    for step in plan_link(&vault, &local) {
        match step {
            LinkStep::Same { id, path } => {
                report.same += 1;
                let hash = local
                    .iter()
                    .find(|f| f.path.eq_ignore_ascii_case(&path))
                    .map(|f| f.hash.clone());
                placed.insert(id, (path, hash.unwrap_or_default()));
            }
            LinkStep::Download { .. } => report.downloaded += 1,
            LinkStep::Upload { .. } => report.uploaded += 1,
            LinkStep::KeepBoth { path, copy, .. } => {
                let local_path = local
                    .iter()
                    .find(|f| f.path.eq_ignore_ascii_case(&path))
                    .map(|f| f.path.clone());
                let from = abs(folder, local_path.as_deref().unwrap_or(&path));
                let to = abs(folder, &copy);
                if let Some(parent) = to.parent() {
                    std::fs::create_dir_all(parent).map_err(Error::io)?;
                }
                std::fs::rename(&from, &to).map_err(Error::io)?;
                report.uploaded += 1;
                report.kept_both.push(copy);
            }
        }
    }

    // From here on, the folder and vault are compared: new files here are
    // added, the vault's files are written here.
    dir.set_placed(placed);
    let msgs = dir.absorb(&mut vault).map_err(Error::io)?;

    let mut uploaded = Vec::new();
    for entry in vault.manifest.entries().into_values() {
        if let (true, Some(hash)) = (
            entry.is_live() && entry.kind == solstice_sync::Kind::Blob,
            entry.hash,
        ) {
            if let Some(bytes) = dir.get_blob(&hash) {
                server
                    .put_blob(token.as_deref(), vault_id, &hash, bytes)
                    .await?;
                uploaded.push(hash);
            }
        }
    }
    send(&mut socket, vault_id, msgs).await?;
    exchange(&mut socket, vault_id, &mut vault, &mut session).await?;
    dir.materialize(&vault).map_err(Error::io)?;
    let _ = socket.close(None).await;

    let link = Link {
        server: server.url().to_string(),
        vault_id: vault_id.to_string(),
        vault_name: vault_name.to_string(),
        device: device.to_string(),
    };
    let store = Store::create(folder, &link)?;
    let mut docs = vec![(
        DocKey::Manifest,
        vault.manifest.epoch,
        vault.manifest.encode_state(),
    )];
    docs.extend(
        vault
            .notes()
            .map(|(id, n)| (DocKey::Note(id.clone()), n.epoch, n.encode_state())),
    );
    store.save(docs, session.export_seen(), uploaded, dir.placed())?;
    Ok(report)
}

/// Forgets a folder's link. Its files stay as they are.
pub fn unlink(folder: &Path) -> Result<(), Error> {
    Store::remove(folder)
}

fn abs(folder: &Path, rel: &str) -> std::path::PathBuf {
    rel.split('/').fold(folder.to_path_buf(), |p, s| p.join(s))
}

async fn send(socket: &mut Socket, vault_id: &str, msgs: Vec<Msg>) -> Result<(), Error> {
    if msgs.is_empty() {
        return Ok(());
    }
    let frame = Frame::new(vault_id, msgs).encode();
    socket
        .send(Message::Binary(frame.into()))
        .await
        .map_err(|e| Error::Network(e.to_string()))
}

/// Answers the server until it goes quiet.
async fn exchange(
    socket: &mut Socket,
    vault_id: &str,
    vault: &mut Vault,
    session: &mut Session,
) -> Result<(), Error> {
    let deadline = tokio::time::Instant::now() + LINK_TIMEOUT;
    loop {
        if tokio::time::Instant::now() > deadline {
            return Err(Error::Network("the server took too long".into()));
        }
        let msg = match tokio::time::timeout(QUIET, socket.next()).await {
            Err(_) => return Ok(()),
            Ok(None) => return Err(Error::Network("the server closed the connection".into())),
            Ok(Some(Err(e))) => return Err(Error::Network(e.to_string())),
            Ok(Some(Ok(m))) => m,
        };
        match msg {
            Message::Binary(bytes) => {
                let frame = Frame::decode(&bytes)?;
                let mut replies = Vec::new();
                for msg in frame.msgs {
                    let out = session.receive(vault, msg)?;
                    if out.events.contains(&solstice_sync::Event::Relink) {
                        return Err(Error::Relink);
                    }
                    replies.extend(out.replies);
                }
                send(socket, vault_id, replies).await?;
            }
            Message::Text(text) if text.contains("unknown_vault") => {
                return Err(Error::NotFound("the server has no such vault".into()))
            }
            _ => {}
        }
    }
}
