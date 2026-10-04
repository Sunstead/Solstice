//! The web app's routes. They read and change a vault through its task
//! (`hub/web.rs`), so devices see web changes as ordinary sync. They take a
//! session (or an app's token), never an API token, and are scoped to the
//! caller's own vaults like everything else.
//!
//! - `GET /v1/me`
//! - `GET /v1/vaults/{id}/tree`
//! - `GET`/`PUT /v1/vaults/{id}/notes/{*path}`: a note's text and `base`; a
//!   save sends both back and returns the merged text.
//! - `GET`/`PUT /v1/vaults/{id}/files/{*path}`: any file's bytes; a PUT
//!   writes a file that isn't a note (`?new=1`: under a free name).
//! - `POST /v1/vaults/{id}/ops`: create, mkdir, rename, trash, duplicate.
//! - `GET /v1/vaults/{id}/reviews`, `GET`/`POST .../reviews/{*path}`.
//! - `GET /v1/web/events?vault=`: a WebSocket of changes to a vault.
//! - `GET`/`PUT /v1/web/settings/{scope}`: settings that follow the user.

use std::time::Duration;

use axum::body::Bytes;
use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{DefaultBodyLimit, Path, Query, State};
use axum::http::{header, HeaderMap, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use futures_util::{SinkExt, StreamExt};
use serde::Deserialize;
use serde_json::json;
use tokio::sync::{mpsc, oneshot};

use crate::api::vault_for;
use crate::auth::{web::same_origin, CurrentUser, Via};
use crate::error::AppError;
use crate::hub::{Cmd, WebOp, WebReply};
use crate::AppState;

const MAX_FILE: usize = 256 * 1024 * 1024;
const MAX_NOTE: usize = 16 * 1024 * 1024;
const MAX_SETTINGS: usize = 256 * 1024;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/v1/me", get(me))
        .route("/v1/vaults/{id}/tree", get(tree))
        .route(
            "/v1/vaults/{id}/notes/{*path}",
            get(read_note)
                .put(save_note)
                .layer(DefaultBodyLimit::max(MAX_NOTE)),
        )
        .route(
            "/v1/vaults/{id}/files/{*path}",
            get(read_file)
                .put(write_file)
                .layer(DefaultBodyLimit::max(MAX_FILE)),
        )
        .route("/v1/vaults/{id}/ops", post(ops))
        .route("/v1/vaults/{id}/reviews", get(reviews))
        .route(
            "/v1/vaults/{id}/reviews/{*path}",
            get(versions).post(resolve),
        )
        .route("/v1/web/events", get(events))
        .route(
            "/v1/web/settings/{scope}",
            get(read_settings)
                .put(write_settings)
                .layer(DefaultBodyLimit::max(MAX_SETTINGS)),
        )
}

async fn me(who: CurrentUser) -> Result<Json<serde_json::Value>, AppError> {
    who.require_person()?;
    Ok(Json(json!({ "username": who.user.username })))
}

/// Runs `op` in the vault's task.
async fn run(
    state: &AppState,
    who: &CurrentUser,
    vault: &str,
    op: WebOp,
) -> Result<WebReply, AppError> {
    who.require_person()?;
    let vault = vault_for(state, who, vault).await?;
    let (reply, rx) = oneshot::channel();
    state
        .hub
        .send(&vault, &who.user.username, Cmd::Web { op, reply })
        .await
        .map_err(AppError::internal)?;
    rx.await.map_err(AppError::internal)?
}

fn json_reply(reply: WebReply) -> Response {
    match reply {
        WebReply::Json(v) => Json(v).into_response(),
        WebReply::File { path, bytes } => file_response(&path, bytes),
    }
}

async fn tree(
    State(state): State<AppState>,
    who: CurrentUser,
    Path(id): Path<String>,
) -> Result<Response, AppError> {
    Ok(json_reply(run(&state, &who, &id, WebOp::Tree).await?))
}

async fn read_note(
    State(state): State<AppState>,
    who: CurrentUser,
    Path((id, path)): Path<(String, String)>,
) -> Result<Response, AppError> {
    Ok(json_reply(
        run(&state, &who, &id, WebOp::ReadNote { path }).await?,
    ))
}

#[derive(Deserialize)]
struct SaveNote {
    text: String,
    /// The `base` the note was read with; absent for a new note.
    base: Option<String>,
}

async fn save_note(
    State(state): State<AppState>,
    who: CurrentUser,
    Path((id, path)): Path<(String, String)>,
    Json(body): Json<SaveNote>,
) -> Result<Response, AppError> {
    let op = WebOp::SaveNote {
        path,
        text: body.text,
        base: body.base,
    };
    Ok(json_reply(run(&state, &who, &id, op).await?))
}

async fn read_file(
    State(state): State<AppState>,
    who: CurrentUser,
    Path((id, path)): Path<(String, String)>,
) -> Result<Response, AppError> {
    Ok(json_reply(
        run(&state, &who, &id, WebOp::ReadFile { path }).await?,
    ))
}

#[derive(Deserialize)]
struct WriteQuery {
    #[serde(default)]
    new: Option<String>,
}

async fn write_file(
    State(state): State<AppState>,
    who: CurrentUser,
    Path((id, path)): Path<(String, String)>,
    Query(q): Query<WriteQuery>,
    body: Bytes,
) -> Result<Response, AppError> {
    let op = WebOp::WriteFile {
        path,
        bytes: body.to_vec(),
        new: q.new.is_some_and(|v| v == "1" || v == "true"),
    };
    Ok(json_reply(run(&state, &who, &id, op).await?))
}

#[derive(Deserialize)]
#[serde(tag = "op", rename_all = "snake_case")]
enum Op {
    CreateNote {
        path: String,
        #[serde(default)]
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
}

async fn ops(
    State(state): State<AppState>,
    who: CurrentUser,
    Path(id): Path<String>,
    Json(op): Json<Op>,
) -> Result<Response, AppError> {
    let op = match op {
        Op::CreateNote { path, text } => WebOp::CreateNote { path, text },
        Op::CreateFolder { path } => WebOp::CreateFolder { path },
        Op::Rename { from, to } => WebOp::Rename { from, to },
        Op::Trash { path } => WebOp::Trash { path },
        Op::Duplicate { path } => WebOp::Duplicate { path },
    };
    Ok(json_reply(run(&state, &who, &id, op).await?))
}

async fn reviews(
    State(state): State<AppState>,
    who: CurrentUser,
    Path(id): Path<String>,
) -> Result<Response, AppError> {
    Ok(json_reply(run(&state, &who, &id, WebOp::Reviews).await?))
}

async fn versions(
    State(state): State<AppState>,
    who: CurrentUser,
    Path((id, path)): Path<(String, String)>,
) -> Result<Response, AppError> {
    Ok(json_reply(
        run(&state, &who, &id, WebOp::Versions { path }).await?,
    ))
}

#[derive(Deserialize, Default)]
struct Resolve {
    /// Saved as the note first, if given.
    text: Option<String>,
}

async fn resolve(
    State(state): State<AppState>,
    who: CurrentUser,
    Path((id, path)): Path<(String, String)>,
    body: Option<Json<Resolve>>,
) -> Result<Response, AppError> {
    let text = body.and_then(|Json(b)| b.text);
    Ok(json_reply(
        run(&state, &who, &id, WebOp::Resolve { path, text }).await?,
    ))
}

// ---------------------------------------------------------------- files

/// A vault file's bytes. A user's HTML or SVG must never run as the app, so
/// everything but PDFs (which the browser's viewer needs scripts for) is
/// served sandboxed, and nothing is sniffed into something it isn't.
fn file_response(path: &str, bytes: Vec<u8>) -> Response {
    let (mime, inline) = content_type(path);
    let mut res = (StatusCode::OK, bytes).into_response();
    let h = res.headers_mut();
    h.insert(header::CONTENT_TYPE, HeaderValue::from_static(mime));
    h.insert(
        header::X_CONTENT_TYPE_OPTIONS,
        HeaderValue::from_static("nosniff"),
    );
    h.insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("private, no-cache"),
    );
    if mime != "application/pdf" {
        h.insert(
            header::CONTENT_SECURITY_POLICY,
            HeaderValue::from_static("sandbox"),
        );
    }
    if !inline {
        h.insert(
            header::CONTENT_DISPOSITION,
            HeaderValue::from_static("attachment"),
        );
    }
    res
}

/// The type to serve a file as, by its extension, and whether it shows in
/// the page (images, media, PDFs, text) or downloads.
fn content_type(path: &str) -> (&'static str, bool) {
    let ext = path
        .rsplit_once('.')
        .map(|(_, e)| e.to_ascii_lowercase())
        .unwrap_or_default();
    match ext.as_str() {
        "md" | "txt" => ("text/plain; charset=utf-8", true),
        "canvas" | "json" => ("application/json", true),
        "png" => ("image/png", true),
        "jpg" | "jpeg" => ("image/jpeg", true),
        "gif" => ("image/gif", true),
        "webp" => ("image/webp", true),
        "avif" => ("image/avif", true),
        "bmp" => ("image/bmp", true),
        "ico" => ("image/x-icon", true),
        "svg" => ("image/svg+xml", true),
        "pdf" => ("application/pdf", true),
        "mp3" => ("audio/mpeg", true),
        "wav" => ("audio/wav", true),
        "ogg" => ("audio/ogg", true),
        "m4a" => ("audio/mp4", true),
        "flac" => ("audio/flac", true),
        "mp4" | "m4v" => ("video/mp4", true),
        "webm" => ("video/webm", true),
        "mov" => ("video/quicktime", true),
        _ => ("application/octet-stream", false),
    }
}

// ---------------------------------------------------------------- events

#[derive(Deserialize)]
struct EventsQuery {
    vault: String,
}

/// How often the socket checks the session still stands and pings.
const EVENTS_TICK: Duration = Duration::from_secs(60);

/// A web app watching one vault. Cookie-authenticated, so the browser's
/// `Origin` must be the server's own: no other site can open it with the
/// user's session.
async fn events(
    State(state): State<AppState>,
    who: CurrentUser,
    headers: HeaderMap,
    Query(q): Query<EventsQuery>,
    ws: WebSocketUpgrade,
) -> Result<Response, AppError> {
    who.require_person()?;
    if !same_origin(&state, &headers) {
        return Err(AppError::forbidden("Cross-origin request refused"));
    }
    let vault = vault_for(&state, &who, &q.vault).await?;
    let (tx, rx) = mpsc::unbounded_channel();
    state
        .hub
        .send(&vault, &who.user.username, Cmd::Watch { tx })
        .await
        .map_err(AppError::internal)?;
    let session = match who.via {
        Via::Web => state.cookie.read(&headers),
        _ => None,
    };
    Ok(ws.on_upgrade(move |socket| watch(socket, state, session, rx)))
}

async fn watch(
    socket: WebSocket,
    state: AppState,
    session: Option<String>,
    mut rx: mpsc::UnboundedReceiver<String>,
) {
    let (mut sink, mut stream) = socket.split();
    let mut tick = tokio::time::interval(EVENTS_TICK);
    tick.tick().await;
    loop {
        tokio::select! {
            event = rx.recv() => match event {
                Some(text) => {
                    if sink.send(Message::Text(text.into())).await.is_err() {
                        break;
                    }
                }
                // The vault's task stopped: the app reconnects.
                None => break,
            },
            msg = stream.next() => match msg {
                Some(Ok(Message::Close(_))) | None | Some(Err(_)) => break,
                _ => {}
            },
            _ = tick.tick() => {
                // Signed out (or expired) since: stop telling.
                if let Some(token) = &session {
                    if !matches!(state.db.session_user(token).await, Ok(Some(_))) {
                        let _ = sink
                            .send(Message::Text(json!({ "notice": "signed_out" }).to_string().into()))
                            .await;
                        break;
                    }
                }
                if sink.send(Message::Ping(Vec::new().into())).await.is_err() {
                    break;
                }
            }
        }
    }
    let _ = sink.send(Message::Close(None)).await;
}

// ---------------------------------------------------------------- settings

/// `global`, or `vault.<id>` and the like: short and plain.
fn check_scope(scope: &str) -> Result<(), AppError> {
    let ok = !scope.is_empty()
        && scope.len() <= 100
        && scope
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'-' | b'_' | b':'));
    ok.then_some(())
        .ok_or_else(|| AppError::bad_request("that isn't a settings scope"))
}

async fn read_settings(
    State(state): State<AppState>,
    who: CurrentUser,
    Path(scope): Path<String>,
) -> Result<Response, AppError> {
    who.require_person()?;
    check_scope(&scope)?;
    let value = state.db.web_setting(who.user.id, &scope).await?;
    let mut res = value.unwrap_or_else(|| "{}".into()).into_response();
    res.headers_mut().insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("application/json"),
    );
    Ok(res)
}

async fn write_settings(
    State(state): State<AppState>,
    who: CurrentUser,
    Path(scope): Path<String>,
    Json(value): Json<serde_json::Value>,
) -> Result<StatusCode, AppError> {
    who.require_person()?;
    check_scope(&scope)?;
    if !value.is_object() {
        return Err(AppError::bad_request("settings are a JSON object"));
    }
    state
        .db
        .put_web_setting(who.user.id, &scope, value.to_string())
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serves_files_by_type_and_downloads_the_rest() {
        assert_eq!(content_type("img/a.PNG"), ("image/png", true));
        assert_eq!(content_type("a.pdf"), ("application/pdf", true));
        assert_eq!(
            content_type("page.html"),
            ("application/octet-stream", false)
        );
        assert_eq!(content_type("noext"), ("application/octet-stream", false));
        let svg = file_response("x.svg", b"<svg/>".to_vec());
        assert_eq!(svg.headers()[header::CONTENT_SECURITY_POLICY], "sandbox");
        assert_eq!(svg.headers()[header::X_CONTENT_TYPE_OPTIONS], "nosniff");
        let pdf = file_response("x.pdf", vec![]);
        assert!(!pdf.headers().contains_key(header::CONTENT_SECURITY_POLICY));
        let html = file_response("x.html", vec![]);
        assert_eq!(html.headers()[header::CONTENT_DISPOSITION], "attachment");
    }

    #[test]
    fn scopes_are_plain() {
        assert!(check_scope("global").is_ok());
        assert!(check_scope("vault.0b9c-uuid").is_ok());
        for bad in ["", "a/b", "../x", "a b", &"x".repeat(101)] {
            assert!(check_scope(bad).is_err(), "{bad:?}");
        }
    }
}
