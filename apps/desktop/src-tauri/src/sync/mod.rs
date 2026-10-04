//! Solstice Sync in the desktop app: signing in, linking the open workspace
//! to a vault, and running a sync client for each linked workspace that a
//! window has open. The sync itself is `crates/solstice-sync-client`; the
//! design is `docs/sync.md`.
//!
//! Tokens never reach the webview: the client asks [`DesktopTokens`] for
//! access tokens, which refreshes the sign-in kept in the OS keychain.

mod oidc;
mod secrets;

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use futures_util::future::BoxFuture;
use serde::{Deserialize, Serialize};
use solstice_sync_client::{AuthInfo, Client, Server, Status, TokenSource};
use specta::Type;
use tauri::{AppHandle, Manager};
use tauri_specta::Event;

/// The sync clients running, by workspace folder, and which window has
/// which folder open (a folder can be open in two windows).
#[derive(Default)]
pub struct SyncState {
    clients: Mutex<HashMap<PathBuf, Client>>,
    windows: Mutex<HashMap<String, PathBuf>>,
}

/// Something about a workspace's sync changed (status, reviews): ask again.
#[derive(Debug, Clone, Serialize, Deserialize, Type, Event)]
pub struct SyncChanged {
    pub root: String,
}

fn key(path: &Path) -> PathBuf {
    path.canonicalize().unwrap_or_else(|_| path.to_path_buf())
}

fn state(app: &AppHandle) -> tauri::State<'_, SyncState> {
    app.state::<SyncState>()
}

fn workspace_of(app: &AppHandle, window: &tauri::Window) -> Result<PathBuf, String> {
    let ws = app.state::<crate::workspace::WorkspaceState>();
    let path = ws.0.lock().unwrap().get(window.label()).cloned().ok_or("Open a folder first.")?;
    Ok(PathBuf::from(path))
}

fn client_for(app: &AppHandle, window: &tauri::Window) -> Result<Option<Client>, String> {
    let root = key(&workspace_of(app, window)?);
    Ok(state(app).clients.lock().unwrap().get(&root).cloned())
}

/// The client whose folder holds `path`, and `path` relative to it.
fn client_for_path(app: &AppHandle, path: &Path) -> Option<(Client, String)> {
    let path = key(path);
    let state = state(app);
    let clients = state.clients.lock().unwrap();
    clients.iter().find_map(|(root, client)| {
        let rel = path.strip_prefix(root).ok()?;
        let parts: Option<Vec<&str>> = rel.iter().map(|c| c.to_str()).collect();
        Some((client.clone(), parts?.join("/")))
    })
}

// ---------------------------------------------------------------- tokens

/// Access tokens for one sync server, from the stored sign-in.
pub struct DesktopTokens {
    server: String,
    auth: tokio::sync::OnceCell<AuthInfo>,
}

impl DesktopTokens {
    pub fn new(server: &str) -> Self {
        Self { server: server.to_string(), auth: tokio::sync::OnceCell::new() }
    }

    async fn auth(&self) -> Result<&AuthInfo, String> {
        self.auth
            .get_or_try_init(|| async {
                let server = Server::new(&self.server).map_err(|e| e.to_string())?;
                server.info().await.map(|i| i.auth).map_err(|e| e.to_string())
            })
            .await
    }
}

impl TokenSource for DesktopTokens {
    fn token(&self) -> BoxFuture<'_, Result<Option<String>, String>> {
        Box::pin(async move {
            match self.auth().await? {
                AuthInfo::Dev => Ok(None),
                AuthInfo::Oidc { issuer, client_id, .. } => oidc::access_token(issuer, client_id).await,
            }
        })
    }
}

async fn token(server: &str) -> Result<Option<String>, String> {
    DesktopTokens::new(server).token().await
}

// ---------------------------------------------------------------- clients

/// The window's workspace changed: start syncing it if it's linked, and stop
/// syncing the one it left if no other window has it open.
pub fn workspace_opened(app: &AppHandle, label: &str, path: &str) {
    let root = key(Path::new(path));
    let previous = state(app).windows.lock().unwrap().insert(label.to_string(), root.clone());
    if let Some(previous) = previous.filter(|p| *p != root) {
        stop_unless_open(app, &previous);
    }
    if solstice_sync_client::is_linked(&root) {
        start(app, &root);
    }
}

/// A window closed.
pub fn window_closed(app: &AppHandle, label: &str) {
    let previous = state(app).windows.lock().unwrap().remove(label);
    if let Some(previous) = previous {
        stop_unless_open(app, &previous);
    }
}

fn stop_unless_open(app: &AppHandle, root: &Path) {
    let still_open = state(app).windows.lock().unwrap().values().any(|r| r == root);
    if !still_open {
        if let Some(client) = state(app).clients.lock().unwrap().remove(root) {
            tauri::async_runtime::spawn(async move { client.stop().await });
        }
    }
}

fn start(app: &AppHandle, root: &Path) {
    if state(app).clients.lock().unwrap().contains_key(root) {
        return;
    }
    let link = match solstice_sync_client::read_link(root) {
        Ok(l) => l,
        Err(e) => return eprintln!("Sync: can't read the link for {}: {e}", root.display()),
    };
    let tokens = Arc::new(DesktopTokens::new(&link.server));
    // The client spawns onto the async runtime, so start it there.
    let (app, root) = (app.clone(), root.to_path_buf());
    tauri::async_runtime::spawn(async move {
        let client = match Client::start(root.clone(), tokens) {
            Ok(c) => c,
            Err(e) => return eprintln!("Sync: can't start for {}: {e}", root.display()),
        };
        state(&app).clients.lock().unwrap().insert(root.clone(), client.clone());
        forward_changes(app, root, client).await;
    });
}

/// Tells the frontend whenever a client's status or reviews change.
async fn forward_changes(app: AppHandle, root: PathBuf, client: Client) {
    let mut status = client.watch_status();
    let mut reviews = client.watch_reviews();
    let event = SyncChanged { root: root.to_string_lossy().into_owned() };
    let _ = event.emit(&app);
    loop {
        tokio::select! {
            r = status.changed() => if r.is_err() { break },
            r = reviews.changed() => if r.is_err() { break },
        }
        let _ = event.emit(&app);
    }
}

/// Called after the app writes a file: an open editor saved it.
pub fn saved(app: &AppHandle, path: &str, contents: &str) {
    if let Some((client, rel)) = client_for_path(app, Path::new(path)) {
        client.saved(&rel, contents);
    }
}

// ---------------------------------------------------------------- commands

#[derive(Debug, Clone, Serialize, Type)]
pub struct SyncServerInfo {
    pub version: String,
    /// `oidc` or `dev` (a development server: no sign-in).
    pub auth: String,
    pub signed_in: bool,
}

#[derive(Debug, Clone, Serialize, Type)]
pub struct SyncVault {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Type)]
pub struct SyncLinkReport {
    pub same: u32,
    pub downloaded: u32,
    pub uploaded: u32,
    pub kept_both: Vec<String>,
}

/// `state` is `connecting`, `syncing`, `synced`, `offline`, `signed_out` or
/// `relink`.
#[derive(Debug, Clone, Serialize, Type)]
pub struct SyncInfo {
    pub server: String,
    pub vault_id: String,
    pub vault_name: String,
    pub device: String,
    pub state: String,
    pub message: Option<String>,
    pub reviews: u32,
}

#[derive(Debug, Clone, Serialize, Type)]
pub struct SyncReview {
    pub id: String,
    pub path: Option<String>,
    /// `overlap` (two devices edited the same text) or `restored` (edited
    /// on one device while deleted on another).
    pub kind: String,
    /// Unix milliseconds.
    pub at: f64,
    pub device: String,
}

#[derive(Debug, Clone, Serialize, Type)]
pub struct SyncVersions {
    pub base: Option<String>,
    pub local: Option<String>,
    pub remote: Option<String>,
    pub merged: String,
}

fn status_parts(status: &Status) -> (String, Option<String>) {
    match status {
        Status::Connecting => ("connecting".into(), None),
        Status::Syncing => ("syncing".into(), None),
        Status::Synced => ("synced".into(), None),
        Status::Offline { message } => ("offline".into(), Some(message.clone())),
        Status::SignedOut => ("signed_out".into(), None),
        Status::Relink => ("relink".into(), None),
    }
}

fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

#[tauri::command]
#[specta::specta]
pub async fn sync_server_info(server: String) -> Result<SyncServerInfo, String> {
    let info = Server::new(&server).map_err(err)?.info().await.map_err(err)?;
    let (auth, signed_in) = match &info.auth {
        AuthInfo::Dev => ("dev".to_string(), true),
        AuthInfo::Oidc { issuer, client_id, .. } => ("oidc".to_string(), oidc::signed_in(issuer, client_id)),
    };
    Ok(SyncServerInfo { version: info.version, auth, signed_in })
}

#[tauri::command]
#[specta::specta]
pub async fn sync_sign_in(app: AppHandle, server: String) -> Result<(), String> {
    let info = Server::new(&server).map_err(err)?.info().await.map_err(err)?;
    if let AuthInfo::Oidc { issuer, client_id, scopes } = &info.auth {
        oidc::sign_in(&app, issuer, client_id, scopes).await?;
    }
    // Clients waiting on a sign-in can connect now.
    for client in state(&app).clients.lock().unwrap().values() {
        client.reconnect();
    }
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn sync_sign_out(server: String) -> Result<(), String> {
    let info = Server::new(&server).map_err(err)?.info().await.map_err(err)?;
    if let AuthInfo::Oidc { issuer, client_id, .. } = &info.auth {
        oidc::sign_out(issuer, client_id).await?;
    }
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn sync_vaults(server: String) -> Result<Vec<SyncVault>, String> {
    let token = token(&server).await?;
    let vaults = Server::new(&server).map_err(err)?.vaults(token.as_deref()).await.map_err(err)?;
    Ok(vaults.into_iter().map(|v| SyncVault { id: v.id, name: v.name }).collect())
}

#[tauri::command]
#[specta::specta]
pub async fn sync_create_vault(server: String, name: String) -> Result<SyncVault, String> {
    let token = token(&server).await?;
    let v = Server::new(&server).map_err(err)?.create_vault(token.as_deref(), &name).await.map_err(err)?;
    Ok(SyncVault { id: v.id, name: v.name })
}

/// An API token for Atlas (it can only list vaults and create notes).
#[tauri::command]
#[specta::specta]
pub async fn sync_create_token(server: String, name: String) -> Result<String, String> {
    let token = token(&server).await?;
    Server::new(&server).map_err(err)?.create_token(token.as_deref(), &name).await.map_err(err)
}

/// Links the window's workspace to a vault and starts syncing it.
#[tauri::command]
#[specta::specta]
pub async fn sync_link(
    app: AppHandle,
    window: tauri::Window,
    server: String,
    vault_id: String,
    vault_name: String,
) -> Result<SyncLinkReport, String> {
    let root = key(&workspace_of(&app, &window)?);
    let device = tauri_plugin_os::hostname();
    let tokens = DesktopTokens::new(&server);
    let report = solstice_sync_client::link(&root, &server, &vault_id, &vault_name, &device, &tokens)
        .await
        .map_err(err)?;
    start(&app, &root);
    Ok(SyncLinkReport {
        same: report.same as u32,
        downloaded: report.downloaded as u32,
        uploaded: report.uploaded as u32,
        kept_both: report.kept_both,
    })
}

/// Stops syncing the window's workspace and forgets its link. Its files
/// stay as they are.
#[tauri::command]
#[specta::specta]
pub async fn sync_unlink(app: AppHandle, window: tauri::Window) -> Result<(), String> {
    let root = key(&workspace_of(&app, &window)?);
    let client = state(&app).clients.lock().unwrap().remove(&root);
    if let Some(client) = client {
        client.stop().await;
    }
    solstice_sync_client::unlink(&root).map_err(err)?;
    let _ = SyncChanged { root: root.to_string_lossy().into_owned() }.emit(&app);
    Ok(())
}

/// The window's workspace's sync, or `None` if it isn't linked.
#[tauri::command]
#[specta::specta]
pub async fn sync_status(app: AppHandle, window: tauri::Window) -> Result<Option<SyncInfo>, String> {
    let Some(client) = client_for(&app, &window)? else { return Ok(None) };
    let link = client.link().clone();
    let (state, message) = status_parts(&client.status());
    let reviews = client.reviews().await.len() as u32;
    Ok(Some(SyncInfo {
        server: link.server,
        vault_id: link.vault_id,
        vault_name: link.vault_name,
        device: link.device,
        state,
        message,
        reviews,
    }))
}

#[tauri::command]
#[specta::specta]
pub fn sync_reconnect(app: AppHandle, window: tauri::Window) -> Result<(), String> {
    if let Some(client) = client_for(&app, &window)? {
        client.reconnect();
    }
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn sync_reviews(app: AppHandle, window: tauri::Window) -> Result<Vec<SyncReview>, String> {
    let Some(client) = client_for(&app, &window)? else { return Ok(vec![]) };
    Ok(client
        .reviews()
        .await
        .into_iter()
        .map(|r| SyncReview { id: r.id, path: r.path, kind: r.kind, at: r.at as f64, device: r.device })
        .collect())
}

#[tauri::command]
#[specta::specta]
pub async fn sync_review_versions(app: AppHandle, window: tauri::Window, id: String) -> Result<SyncVersions, String> {
    let client = client_for(&app, &window)?.ok_or("This folder isn't synced.")?;
    let v = client.versions(&id).await.map_err(err)?;
    Ok(SyncVersions { base: v.base, local: v.local, remote: v.remote, merged: v.merged })
}

/// Clears a review, first saving `text` as the note if given.
#[tauri::command]
#[specta::specta]
pub async fn sync_resolve_review(
    app: AppHandle,
    window: tauri::Window,
    id: String,
    text: Option<String>,
) -> Result<(), String> {
    let client = client_for(&app, &window)?.ok_or("This folder isn't synced.")?;
    client.resolve(&id, text).await.map_err(err)
}

/// An editor loaded (or reloaded) a file's text. Its later saves are merged
/// against exactly this.
/// The sync vault each folder is linked to (`None` if it isn't), so a
/// `solstice://open?vault=` link finds a folder by its vault's name even
/// when the folder is named differently.
#[tauri::command]
#[specta::specta]
pub async fn sync_vault_names(paths: Vec<String>) -> Vec<Option<String>> {
    tokio::task::spawn_blocking(move || {
        paths
            .iter()
            .map(|p| solstice_sync_client::read_link(Path::new(p)).ok().map(|l| l.vault_name))
            .collect()
    })
    .await
    .unwrap_or_default()
}

#[tauri::command]
#[specta::specta]
pub fn sync_editor_opened(app: AppHandle, path: String, text: String) {
    if let Some((client, rel)) = client_for_path(&app, Path::new(&path)) {
        client.editor_opened(&rel, &text);
    }
}
