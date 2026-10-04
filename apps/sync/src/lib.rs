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
pub mod web;
pub mod web_api;

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
    /// Where browsers reach the server, for web sign-in.
    pub public_url: Option<url::Url>,
    pub cookie: auth::web::CookieSpec,
    pub web_dir: Option<PathBuf>,
}

impl AppState {
    pub fn new(config: &config::Config, db: db::Db) -> Self {
        Self {
            hub: hub::Hub::new(db.clone(), config.notes_dir.clone()),
            auth: Arc::new(auth::Auth::new(&config.auth)),
            db,
            notes_dir: config.notes_dir.clone(),
            public_url: config.public_url.clone(),
            cookie: auth::web::CookieSpec::for_url(config.public_url.as_ref()),
            web_dir: config.web_dir.clone(),
        }
    }
}

/// The whole HTTP surface.
pub fn app(state: AppState) -> Router {
    let routes = api::router()
        .merge(web_api::router())
        .merge(auth::web::router());
    let routes = match state.web_dir.as_deref().and_then(web::router) {
        // The web app answers everything the server doesn't.
        Some(site) => routes.fallback_service(site.with_state(state.clone())),
        None => routes
            // For people (and uptime checks) who open the address in a browser.
            .route(
                "/",
                axum::routing::get(|| async {
                    "Solstice Sync is running. Connect to it from the Solstice app.\n"
                }),
            )
            .fallback(|| async { error::AppError::not_found() }),
    };
    routes
        .layer(axum::middleware::from_fn_with_state(state.clone(), auth::web::csrf))
        // Paths only: `?token=` on the WebSocket must never reach the logs.
        .layer(TraceLayer::new_for_http().make_span_with(|req: &axum::http::Request<_>| {
            tracing::info_span!("http", method = %req.method(), path = %req.uri().path())
        }))
        .with_state(state)
}

#[cfg(test)]
mod web_tests;
