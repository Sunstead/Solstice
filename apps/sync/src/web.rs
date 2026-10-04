//! Serves the web app's build (`SOLSTICE_WEB_DIR`) from the server's own
//! origin, so the browser needs no CORS and the session cookie covers both.
//! Adapted from Atlas (`atlas-server/src/web.rs`).
//!
//! The app shell is gated: a page load without a session goes to sign-in,
//! carrying the path and query, so a link to a note survives the round
//! trip. Static files (hashed assets, icons) are public; they hold no data.
//! The shell gets a strict content security policy: scripts only from the
//! server, plus the inline first-paint script by its hash.

use std::path::Path;

use axum::body::Body;
use axum::extract::{Request, State};
use axum::http::{header, HeaderValue, Method, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Router;
use base64::Engine;
use sha2::{Digest, Sha256};
use tower_http::services::ServeDir;

use crate::auth::web::session_user;
use crate::auth::Auth;
use crate::AppState;

/// Path prefixes the server owns. Anything under them no route matched is a
/// 404, never the app shell.
const SERVER_PREFIXES: &[&str] = &["/v1", "/auth", "/healthz"];

/// `None` when `dir` has no `index.html`, so a bad path degrades to the API.
pub fn router(dir: &Path) -> Option<Router<AppState>> {
    let index = match std::fs::read_to_string(dir.join("index.html")) {
        Ok(html) => html,
        Err(_) => {
            tracing::warn!(dir = %dir.display(), "SOLSTICE_WEB_DIR has no index.html; not serving the web app");
            return None;
        }
    };
    tracing::info!(dir = %dir.display(), "serving the web app");
    let csp = HeaderValue::from_str(&content_security_policy(&index)).ok()?;
    let files = ServeDir::new(dir);
    Some(
        Router::new().fallback(move |State(state): State<AppState>, req: Request| {
            serve(state, files.clone(), csp.clone(), req)
        }),
    )
}

/// The shell's policy. Styles allow inline: themes and the editor set them
/// at runtime. Images and media may come from `blob:` (pasted images) and
/// `data:`. Workers (the PDF viewer) from the server or `blob:`.
fn content_security_policy(index_html: &str) -> String {
    let scripts: String = inline_scripts(index_html)
        .map(|s| {
            let hash =
                base64::engine::general_purpose::STANDARD.encode(Sha256::digest(s.as_bytes()));
            format!(" 'sha256-{hash}'")
        })
        .collect();
    format!(
        "default-src 'self'; script-src 'self'{scripts}; style-src 'self' 'unsafe-inline'; \
         img-src 'self' data: blob:; media-src 'self' blob:; font-src 'self' data:; \
         connect-src 'self'; worker-src 'self' blob:; frame-src 'self'; object-src 'none'; \
         base-uri 'none'; form-action 'self'; frame-ancestors 'none'"
    )
}

/// The bodies of `<script>` elements without a `src`.
fn inline_scripts(html: &str) -> impl Iterator<Item = &str> {
    html.match_indices("<script").filter_map(move |(at, _)| {
        let open_end = at + html[at..].find('>')?;
        let open = &html[at..open_end];
        if open.contains("src=") {
            return None;
        }
        let body_start = open_end + 1;
        let body_end = body_start + html[body_start..].find("</script>")?;
        Some(&html[body_start..body_end])
    })
}

fn is_server_path(path: &str) -> bool {
    SERVER_PREFIXES.iter().any(|p| {
        path == *p
            || path
                .strip_prefix(p)
                .is_some_and(|rest| rest.starts_with('/'))
    })
}

async fn serve(state: AppState, mut files: ServeDir, csp: HeaderValue, req: Request) -> Response {
    let path = req.uri().path().to_owned();
    if is_server_path(&path) {
        return crate::error::AppError::not_found().into_response();
    }
    if req.method() != Method::GET && req.method() != Method::HEAD {
        return StatusCode::METHOD_NOT_ALLOWED.into_response();
    }
    let path_and_query = req
        .uri()
        .path_and_query()
        .map(|p| p.as_str().to_owned())
        .unwrap_or_else(|| path.clone());
    let headers = req.headers().clone();

    // Hashed build output never changes; everything else revalidates so a
    // deploy is picked up on the next load.
    let asset = path.starts_with("/assets/");
    let mut res = match files.try_call(req).await {
        Ok(res) => res.map(Body::new),
        Err(_) => return StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    };

    // Client-side routes get the app shell. Missing assets stay 404 so a
    // stale chunk isn't cached as HTML.
    let fallback = res.status() == StatusCode::NOT_FOUND && !asset;
    let shell = fallback || path == "/" || path == "/index.html";
    if shell && !matches!(*state.auth, Auth::Dev { .. }) {
        match session_user(&state, &headers).await {
            Ok(Some(_)) => {}
            Ok(None) => return sign_in(&path_and_query),
            Err(e) => return e.into_response(),
        }
    }
    if fallback {
        let index = Request::builder()
            .uri("/index.html")
            .body(Body::empty())
            .unwrap_or_default();
        res = match files.try_call(index).await {
            Ok(res) => res.map(Body::new),
            Err(_) => return StatusCode::INTERNAL_SERVER_ERROR.into_response(),
        };
    }

    let cache = if asset && res.status().is_success() {
        "public, max-age=31536000, immutable"
    } else {
        "no-cache"
    };
    let h = res.headers_mut();
    h.insert(header::CACHE_CONTROL, HeaderValue::from_static(cache));
    h.insert(
        header::X_CONTENT_TYPE_OPTIONS,
        HeaderValue::from_static("nosniff"),
    );
    h.insert(header::X_FRAME_OPTIONS, HeaderValue::from_static("DENY"));
    h.insert(
        header::REFERRER_POLICY,
        HeaderValue::from_static("no-referrer"),
    );
    if shell {
        h.insert(header::CONTENT_SECURITY_POLICY, csp);
    }
    res
}

fn sign_in(return_to: &str) -> Response {
    let to = format!(
        "/auth/login?return_to={}",
        url::form_urlencoded::byte_serialize(return_to.as_bytes()).collect::<String>()
    );
    (
        StatusCode::FOUND,
        [
            (header::LOCATION, to.as_str()),
            (header::CACHE_CONTROL, "no-store"),
        ],
    )
        .into_response()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hashes_inline_scripts_only() {
        let html = r#"<head><script>paint();</script><script type="module" src="/assets/app.js"></script></head>"#;
        let found: Vec<_> = inline_scripts(html).collect();
        assert_eq!(found, ["paint();"]);
        let csp = content_security_policy(html);
        let hash = base64::engine::general_purpose::STANDARD.encode(Sha256::digest(b"paint();"));
        assert!(
            csp.contains(&format!("script-src 'self' 'sha256-{hash}';")),
            "{csp}"
        );
        assert!(csp.contains("frame-ancestors 'none'"));
    }

    #[test]
    fn server_paths_are_whole_segments() {
        assert!(is_server_path("/v1"));
        assert!(is_server_path("/v1/nope"));
        assert!(is_server_path("/auth/x"));
        assert!(!is_server_path("/v1beta"));
        assert!(!is_server_path("/vault/Notes"));
    }
}
