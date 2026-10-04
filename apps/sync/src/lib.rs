//! Solstice Sync's server. Vaults are plain folders of files under the notes
//! dir (`<user>/<vault>/`) plus each document's Yjs state in SQLite; devices
//! sync them over one WebSocket each. The engine (documents, merges, the
//! protocol) is `crates/solstice-sync`; this is storage, files, auth and
//! transport around it. Design: `docs/sync.md`.

pub mod api;
pub mod auth;
pub mod config;
pub mod db;
pub mod error;
pub mod hub;

use std::path::PathBuf;
use std::sync::Arc;

use axum::Router;
use tower_http::trace::TraceLayer;

#[derive(Clone)]
pub struct AppState {
    pub db: db::Db,
    pub auth: Arc<auth::Auth>,
    pub hub: hub::Hub,
    pub notes_dir: PathBuf,
}

impl AppState {
    pub fn new(config: &config::Config, db: db::Db) -> Self {
        Self {
            hub: hub::Hub::new(db.clone(), config.notes_dir.clone()),
            auth: Arc::new(auth::Auth::new(&config.auth)),
            db,
            notes_dir: config.notes_dir.clone(),
        }
    }
}

/// The whole HTTP surface.
pub fn app(state: AppState) -> Router {
    api::router()
        // Paths only: `?token=` on the WebSocket must never reach the logs.
        .layer(TraceLayer::new_for_http().make_span_with(|req: &axum::http::Request<_>| {
            tracing::info_span!("http", method = %req.method(), path = %req.uri().path())
        }))
        .with_state(state)
}
