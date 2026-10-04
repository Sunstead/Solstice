//! `solstice-sync`: the Solstice Sync server.

use solstice_sync_server::config::{AuthMode, Config};
use solstice_sync_server::{app, db::Db, AppState};
use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() {
    // Development convenience only: release builds take their config from
    // the real environment (compose), never a stray file.
    #[cfg(debug_assertions)]
    let dotenv = dotenvy::dotenv().ok();

    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")),
        )
        // Colour only on a terminal; `docker logs` should be plain text.
        .with_ansi(std::io::IsTerminal::is_terminal(&std::io::stdout()))
        .init();

    #[cfg(debug_assertions)]
    if let Some(path) = dotenv {
        tracing::info!(path = %path.display(), "loaded development settings");
    }

    let config = match Config::from_env(|k| std::env::var(k).ok()) {
        Ok(c) => c,
        Err(e) => fail(2, &e.to_string()),
    };
    let db = match Db::open(&config.state_dir) {
        Ok(db) => db,
        Err(e) => fail(
            2,
            &format!("state database in {}: {e}", config.state_dir.display()),
        ),
    };
    if let Err(e) = std::fs::create_dir_all(&config.notes_dir) {
        fail(2, &format!("notes dir {}: {e}", config.notes_dir.display()));
    }
    match &config.auth {
        AuthMode::Oidc(o) => tracing::info!(issuer = %o.issuer, "sign-in with OIDC"),
        AuthMode::Dev { username } => {
            tracing::warn!(user = %username, "DEVELOPMENT SIGN-IN: anyone who reaches this server is this user")
        }
    }

    let state = AppState::new(&config, db);
    state.auth.start();
    let hub = state.hub.clone();
    let listener = match tokio::net::TcpListener::bind(config.bind).await {
        Ok(l) => l,
        Err(e) => fail(1, &format!("can't listen on {}: {e}", config.bind)),
    };
    tracing::info!(bind = %config.bind, version = env!("CARGO_PKG_VERSION"), "solstice-sync listening");
    if let Err(e) = axum::serve(listener, app(state))
        .with_graceful_shutdown(shutdown())
        .await
    {
        fail(1, &format!("server error: {e}"));
    }
    // Every vault saves its state before the process ends.
    hub.shutdown().await;
}

fn fail(code: i32, message: &str) -> ! {
    tracing::error!("{message}");
    std::process::exit(code);
}

/// Ctrl-C, or SIGTERM from `docker stop`.
async fn shutdown() {
    let ctrl_c = async {
        let _ = tokio::signal::ctrl_c().await;
    };
    #[cfg(unix)]
    let term = async {
        match tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()) {
            Ok(mut s) => {
                s.recv().await;
            }
            Err(_) => std::future::pending().await,
        }
    };
    #[cfg(not(unix))]
    let term = std::future::pending::<()>();

    tokio::select! {
        _ = ctrl_c => {},
        _ = term => {},
    }
    tracing::info!("shutting down");
}
