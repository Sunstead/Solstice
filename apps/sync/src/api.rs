//! The HTTP surface:
//!
//! - `GET /healthz`, `GET /v1/info` (how apps sign in): public.
//! - `GET /v1/vaults`, `POST /v1/vaults/{id}/notes`: apps and API tokens.
//! - `POST /v1/vaults`, `/v1/tokens`, blobs, and `GET /v1/sync` (the
//!   WebSocket): apps only.

use std::collections::{BTreeMap, BTreeSet};
use std::sync::atomic::{AtomicU64, Ordering};

use axum::body::Bytes;
use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{DefaultBodyLimit, Path, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::{delete, get, post};
use axum::{Json, Router};
use futures_util::{SinkExt, StreamExt};
use serde::Deserialize;
use solstice_sync::{content_hash, Frame, PROTOCOL};
use tokio::sync::{mpsc, oneshot};

use crate::auth::{Auth, CurrentUser};
use crate::db::VaultRow;
use crate::error::AppError;
use crate::hub::{notice, Cmd, Outgoing};
use crate::AppState;

const MAX_BLOB: usize = 256 * 1024 * 1024;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/healthz", get(|| async { "ok" }))
        .route("/v1/info", get(info))
        .route("/v1/vaults", get(list_vaults).post(create_vault))
        .route("/v1/vaults/{id}/notes", post(create_note))
        .route(
            "/v1/vaults/{id}/blobs/{hash}",
            get(get_blob)
                .put(put_blob)
                .layer(DefaultBodyLimit::max(MAX_BLOB)),
        )
        .route("/v1/tokens", get(list_tokens).post(create_token))
        .route("/v1/tokens/{id}", delete(delete_token))
        .route("/v1/sync", get(sync))
        .fallback(|| async { AppError::not_found() })
}

async fn info(State(state): State<AppState>) -> Json<serde_json::Value> {
    let auth = match &*state.auth {
        Auth::Oidc { config, .. } => serde_json::json!({
            "kind": "oidc",
            "issuer": config.issuer,
            "client_id": config.client_id,
            "scopes": config.scopes,
        }),
        Auth::Dev { .. } => serde_json::json!({ "kind": "dev" }),
    };
    Json(serde_json::json!({
        "version": env!("CARGO_PKG_VERSION"),
        "protocol": PROTOCOL,
        "auth": auth,
    }))
}

/// A vault name is its folder's name: one visible path segment.
fn check_vault_name(name: &str) -> Result<String, AppError> {
    let name = name.trim();
    match solstice_core::VaultPath::parse(name) {
        Ok(p) if !p.is_hidden() && !p.as_str().contains('/') => Ok(p.to_string()),
        _ => Err(AppError::bad_request(format!(
            "{name:?} can't be a vault name: use one folder name"
        ))),
    }
}

/// The user's vaults. Folders in their notes dir that aren't vaults yet
/// (made by hand, or the database was lost) become vaults here.
async fn list_vaults(
    State(state): State<AppState>,
    who: CurrentUser,
) -> Result<Json<Vec<VaultRow>>, AppError> {
    let mut vaults = state.db.vaults(who.user.id).await?;
    let names: BTreeSet<String> = vaults.iter().map(|v| v.name.clone()).collect();
    if let Ok(entries) = std::fs::read_dir(state.notes_dir.join(&who.user.username)) {
        for entry in entries.flatten() {
            let Some(name) = entry.file_name().to_str().map(str::to_owned) else {
                continue;
            };
            let is_dir = entry.file_type().is_ok_and(|t| t.is_dir());
            if is_dir && !names.contains(&name) && check_vault_name(&name).is_ok() {
                vaults.push(state.db.create_vault(who.user.id, &name).await?);
            }
        }
    }
    vaults.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(Json(vaults))
}

#[derive(Deserialize)]
struct NewVault {
    name: String,
}

async fn create_vault(
    State(state): State<AppState>,
    who: CurrentUser,
    Json(body): Json<NewVault>,
) -> Result<(StatusCode, Json<VaultRow>), AppError> {
    who.require_app()?;
    let name = check_vault_name(&body.name)?;
    let row = state.db.create_vault(who.user.id, &name).await?;
    std::fs::create_dir_all(state.hub.folder(&who.user.username, &name))
        .map_err(AppError::internal)?;
    Ok((StatusCode::CREATED, Json(row)))
}

async fn vault_for(state: &AppState, who: &CurrentUser, id: &str) -> Result<VaultRow, AppError> {
    Ok(state.db.vault(who.user.id, id).await?)
}

#[derive(Deserialize)]
struct NewNote {
    path: String,
    #[serde(default)]
    text: String,
}

/// Creates a note (Atlas uses this). Returns its id and where it landed,
/// which is numbered if the path was taken.
async fn create_note(
    State(state): State<AppState>,
    who: CurrentUser,
    Path(id): Path<String>,
    Json(body): Json<NewNote>,
) -> Result<(StatusCode, Json<serde_json::Value>), AppError> {
    let vault = vault_for(&state, &who, &id).await?;
    if !body.path.to_ascii_lowercase().ends_with(".md") {
        return Err(AppError::bad_request("a note's path must end in .md"));
    }
    let (reply, rx) = oneshot::channel();
    state
        .hub
        .send(
            &vault,
            &who.user.username,
            Cmd::CreateNote {
                path: body.path,
                text: body.text,
                reply,
            },
        )
        .await
        .map_err(AppError::internal)?;
    let (note, path) = rx
        .await
        .map_err(AppError::internal)?
        .map_err(AppError::bad_request)?;
    Ok((
        StatusCode::CREATED,
        Json(serde_json::json!({ "id": note, "path": path })),
    ))
}

async fn put_blob(
    State(state): State<AppState>,
    who: CurrentUser,
    Path((id, hash)): Path<(String, String)>,
    body: Bytes,
) -> Result<StatusCode, AppError> {
    who.require_app()?;
    let vault = vault_for(&state, &who, &id).await?;
    if content_hash(&body) != hash {
        return Err(AppError::bad_request("the content doesn't match its hash"));
    }
    let (reply, rx) = oneshot::channel();
    state
        .hub
        .send(
            &vault,
            &who.user.username,
            Cmd::PutBlob {
                bytes: body.to_vec(),
                reply,
            },
        )
        .await
        .map_err(AppError::internal)?;
    rx.await
        .map_err(AppError::internal)?
        .map_err(AppError::internal)?;
    Ok(StatusCode::NO_CONTENT)
}

async fn get_blob(
    State(state): State<AppState>,
    who: CurrentUser,
    Path((id, hash)): Path<(String, String)>,
) -> Result<Response, AppError> {
    who.require_app()?;
    let vault = vault_for(&state, &who, &id).await?;
    let (reply, rx) = oneshot::channel();
    state
        .hub
        .send(&vault, &who.user.username, Cmd::GetBlob { hash, reply })
        .await
        .map_err(AppError::internal)?;
    match rx.await.map_err(AppError::internal)? {
        Some(bytes) => Ok(([("content-type", "application/octet-stream")], bytes).into_response()),
        None => Err(AppError::not_found()),
    }
}

async fn list_tokens(
    State(state): State<AppState>,
    who: CurrentUser,
) -> Result<Json<Vec<crate::db::TokenRow>>, AppError> {
    who.require_app()?;
    Ok(Json(state.db.tokens(who.user.id).await?))
}

#[derive(Deserialize)]
struct NewToken {
    name: String,
}

/// Makes an API token. The only time the token itself is shown.
async fn create_token(
    State(state): State<AppState>,
    who: CurrentUser,
    Json(body): Json<NewToken>,
) -> Result<(StatusCode, Json<serde_json::Value>), AppError> {
    who.require_app()?;
    let name = body.name.trim();
    if name.is_empty() || name.len() > 100 {
        return Err(AppError::bad_request(
            "give the token a name (up to 100 characters)",
        ));
    }
    let (token, row) = state.db.create_token(who.user.id, name).await?;
    Ok((
        StatusCode::CREATED,
        Json(serde_json::json!({ "token": token, "info": row })),
    ))
}

async fn delete_token(
    State(state): State<AppState>,
    who: CurrentUser,
    Path(id): Path<i64>,
) -> Result<StatusCode, AppError> {
    who.require_app()?;
    state.db.delete_token(who.user.id, id).await?;
    Ok(StatusCode::NO_CONTENT)
}

// ---------------------------------------------------------------- sync

static NEXT_CONN: AtomicU64 = AtomicU64::new(1);

async fn sync(
    State(state): State<AppState>,
    who: CurrentUser,
    ws: WebSocketUpgrade,
) -> Result<Response, AppError> {
    who.require_app()?;
    Ok(ws.on_upgrade(move |socket| connection(socket, state, who)))
}

/// One device's connection. Binary messages are [`Frame`]s, each for one
/// of the user's vaults; the server answers with frames, and with JSON text
/// notices for problems (an unknown vault, a bad frame).
async fn connection(socket: WebSocket, state: AppState, who: CurrentUser) {
    let conn = NEXT_CONN.fetch_add(1, Ordering::Relaxed);
    let (mut sink, mut stream) = socket.split();
    let (tx, mut rx) = mpsc::unbounded_channel::<Outgoing>();
    let writer = tokio::spawn(async move {
        while let Some(out) = rx.recv().await {
            let msg = match out {
                Outgoing::Frame(bytes) => Message::Binary(bytes.into()),
                Outgoing::Notice(text) => Message::Text(text.into()),
            };
            if sink.send(msg).await.is_err() {
                break;
            }
        }
    });

    let mut vaults: BTreeMap<String, VaultRow> = BTreeMap::new();
    while let Some(Ok(msg)) = stream.next().await {
        let bytes = match msg {
            Message::Binary(bytes) => bytes,
            Message::Close(_) => break,
            _ => continue,
        };
        let frame = match Frame::decode(&bytes) {
            Ok(f) => f,
            Err(e) => {
                let _ = tx.send(Outgoing::Notice(
                    serde_json::json!({ "notice": "bad_frame", "detail": e.to_string() })
                        .to_string(),
                ));
                continue;
            }
        };
        let row = match vaults.get(&frame.vault) {
            Some(row) => row.clone(),
            None => match state.db.vault(who.user.id, &frame.vault).await {
                Ok(row) => {
                    let connect = Cmd::Connect {
                        conn,
                        tx: tx.clone(),
                    };
                    if let Err(e) = state.hub.send(&row, &who.user.username, connect).await {
                        tracing::warn!(error = %e, "can't open a vault");
                        let _ = tx.send(Outgoing::Notice(notice(&frame.vault, "unavailable")));
                        continue;
                    }
                    vaults.insert(row.id.clone(), row.clone());
                    row
                }
                Err(_) => {
                    let _ = tx.send(Outgoing::Notice(notice(&frame.vault, "unknown_vault")));
                    continue;
                }
            },
        };
        let cmd = Cmd::Frame {
            conn,
            msgs: frame.msgs,
        };
        if let Err(e) = state.hub.send(&row, &who.user.username, cmd).await {
            tracing::warn!(error = %e, "can't reach a vault");
        }
    }
    state
        .hub
        .disconnect(conn, &vaults.keys().cloned().collect());
    writer.abort();
}
