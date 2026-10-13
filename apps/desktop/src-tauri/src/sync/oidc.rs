//! Sign-in to Solstice Sync: OpenID Connect authorization code with PKCE,
//! using a loopback redirect (RFC 8252). Ported from Cosmos
//! (`app/src-tauri/src/oidc.rs`).
//!
//! We listen on 127.0.0.1 on a random port, open the system browser at the
//! provider (on iOS, the sign-in sheet: see `in_sheet`), and catch the
//! redirect back. The provider allows any port on
//! `http://127.0.0.1/callback` for the Solstice client. The code exchange and
//! every refresh happen here, and the tokens never reach the webview: the
//! sync client asks for access tokens itself.

use super::secrets;
use base64::{ engine::general_purpose::URL_SAFE_NO_PAD, Engine };
use serde::Deserialize;
use sha2::{ Digest, Sha256 };
use std::{ collections::HashMap, sync::LazyLock, time::{ Duration, Instant } };
use tokio::sync::Mutex;
use tauri::{ AppHandle, Manager, Runtime };
#[cfg(not(target_os = "ios"))]
use tauri_plugin_opener::OpenerExt;
use tokio::{ io::{ AsyncReadExt, AsyncWriteExt }, net::TcpListener };

/// Long enough to type a password and find a passkey.
const SIGN_IN_TIMEOUT: Duration = Duration::from_secs(300);
const HTTP_TIMEOUT: Duration = Duration::from_secs(15);

#[derive(Deserialize)]
struct Discovery {
    authorization_endpoint: String,
    token_endpoint: String,
    #[serde(default)]
    revocation_endpoint: Option<String>,
}

#[derive(Deserialize)]
struct TokenResponse {
    access_token: String,
    #[serde(default)]
    refresh_token: Option<String>,
    #[serde(default)]
    expires_in: Option<u64>,
}

/// An access token, kept until shortly before it expires.
struct Cached {
    token: String,
    until: Instant,
}

/// Access tokens by sign-in, and the lock every refresh takes. The provider
/// rotates the refresh token on each use, so two refreshes at once would
/// race: the loser's `invalid_grant` used to delete the winner's new token,
/// which signed you out.
static TOKENS: LazyLock<Mutex<HashMap<String, Cached>>> = LazyLock::new(Default::default);

/// Refreshed this long before the provider says the token expires.
const EXPIRY_MARGIN: Duration = Duration::from_secs(60);
/// For a provider that doesn't say.
const DEFAULT_LIFETIME: Duration = Duration::from_secs(300);

#[derive(Deserialize)]
struct TokenError {
    error: String,
    #[serde(default)]
    error_description: Option<String>,
}

fn account(issuer: &str, client_id: &str) -> String {
    format!("oidc:{client_id}@{issuer}")
}

fn http() -> Result<reqwest::Client, String> {
    reqwest::Client
        ::builder()
        .timeout(HTTP_TIMEOUT)
        .build()
        .map_err(|e| e.to_string())
}

async fn discover(client: &reqwest::Client, issuer: &str) -> Result<Discovery, String> {
    let url = format!("{}/.well-known/openid-configuration", issuer.trim_end_matches('/'));
    let res = client
        .get(&url)
        .send().await
        .map_err(|e| format!("Could not reach the sign-in provider: {e}"))?;
    if !res.status().is_success() {
        return Err(format!("The sign-in provider answered {}", res.status()));
    }
    res.json().await.map_err(|e| e.to_string())
}

fn random(bytes: usize) -> Result<String, String> {
    let mut buf = vec![0u8; bytes];
    getrandom::fill(&mut buf).map_err(|e| e.to_string())?;
    Ok(URL_SAFE_NO_PAD.encode(buf))
}

fn challenge(verifier: &str) -> String {
    URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()))
}

/// `Err` carries the provider's error code, so `invalid_grant` can be told
/// apart from a network failure.
async fn token_request(
    client: &reqwest::Client,
    endpoint: &str,
    form: &[(&str, &str)]
) -> Result<TokenResponse, (Option<String>, String)> {
    let res = client
        .post(endpoint)
        .form(form)
        .send().await
        .map_err(|e| (None, e.to_string()))?;
    let status = res.status();
    let body = res.bytes().await.map_err(|e| (None, e.to_string()))?;
    if status.is_success() {
        return serde_json::from_slice(&body).map_err(|e| (None, e.to_string()));
    }
    match serde_json::from_slice::<TokenError>(&body) {
        Ok(e) => {
            let message = e.error_description.clone().unwrap_or_else(|| e.error.clone());
            Err((Some(e.error), message))
        }
        Err(_) => Err((None, format!("Sign-in failed ({status})"))),
    }
}

/// Reads one HTTP request line from the browser and answers it. Returns
/// the query string when it's the callback, `None` for anything else (the
/// browser may ask for /favicon.ico).
async fn serve_one(stream: &mut tokio::net::TcpStream) -> Option<String> {
    let mut buf = vec![0u8; 8192];
    let n = stream.read(&mut buf).await.ok()?;
    let request = String::from_utf8_lossy(&buf[..n]);
    let target = request.lines().next()?.split_whitespace().nth(1)?.to_string();

    let (path, query) = target.split_once('?').unwrap_or((target.as_str(), ""));
    let is_callback = path == "/callback";
    let page = if is_callback {
        "<!doctype html><meta charset=utf-8><title>Solstice</title>\
         <body style=\"font:15px system-ui;display:grid;place-items:center;height:90vh\">\
         <p>Signed in to Solstice Sync. You can close this tab.</p>"
    } else {
        ""
    };
    let status = if is_callback { "200 OK" } else { "404 Not Found" };
    let response = format!(
        "HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{page}",
        page.len()
    );
    let _ = stream.write_all(response.as_bytes()).await;
    let _ = stream.shutdown().await;
    is_callback.then(|| query.to_string())
}

/// Opens the browser at the provider and waits for the user to come back.
pub async fn sign_in<R: Runtime>(
    app: &AppHandle<R>,
    issuer: &str,
    client_id: &str,
    scopes: &str
) -> Result<(), String> {
    let (issuer, client_id, scopes) = (issuer.to_string(), client_id.to_string(), scopes.to_string());
    let client = http()?;
    let d = discover(&client, &issuer).await?;

    let listener = TcpListener::bind("127.0.0.1:0").await.map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let redirect_uri = format!("http://127.0.0.1:{port}/callback");

    let verifier = random(32)?;
    let state = random(16)?;
    let mut url = url::Url::parse(&d.authorization_endpoint).map_err(|e| e.to_string())?;
    url.query_pairs_mut()
        .append_pair("response_type", "code")
        .append_pair("client_id", &client_id)
        .append_pair("redirect_uri", &redirect_uri)
        .append_pair("scope", &scopes)
        .append_pair("state", &state)
        .append_pair("code_challenge", &challenge(&verifier))
        .append_pair("code_challenge_method", "S256");

    let callback = tokio::time::timeout(SIGN_IN_TIMEOUT, async {
        loop {
            let (mut stream, _) = listener.accept().await.map_err(|e| e.to_string())?;
            if let Some(q) = serve_one(&mut stream).await {
                return Ok::<_, String>(q);
            }
        }
    });

    #[cfg(not(target_os = "ios"))]
    let callback = {
        app.opener()
            .open_url(url.as_str(), None::<&str>)
            .map_err(|e| format!("Could not open the browser: {e}"))?;
        callback.await
    };
    #[cfg(target_os = "ios")]
    let callback = in_sheet(app, url.as_str(), callback).await?;

    let query = callback.map_err(|_| "Sign-in timed out. Try again.".to_string())??;
    drop(listener);

    // Back to the app, not left behind the browser.
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.set_focus();
    }

    let params: std::collections::HashMap<String, String> = url::form_urlencoded
        ::parse(query.as_bytes())
        .into_owned()
        .collect();
    if let Some(error) = params.get("error") {
        return Err(
            params
                .get("error_description")
                .cloned()
                .unwrap_or_else(|| format!("Sign-in was refused ({error})"))
        );
    }
    if params.get("state") != Some(&state) {
        return Err("The sign-in response did not match the request. Try again.".into());
    }
    let code = params.get("code").ok_or("The provider sent no code.")?;

    let tokens = token_request(
        &client,
        &d.token_endpoint,
        &[
            ("grant_type", "authorization_code"),
            ("code", code),
            ("redirect_uri", &redirect_uri),
            ("client_id", &client_id),
            ("code_verifier", &verifier),
        ]
    ).await.map_err(|(_, m)| m)?;

    let key = account(&issuer, &client_id);
    let mut cache = TOKENS.lock().await;
    match &tokens.refresh_token {
        Some(rt) => secrets::set(&key, rt)?,
        None => return Err("The sign-in provider gave no refresh token (is offline_access allowed?)".into()),
    }
    cache.insert(key, cached(&tokens));
    Ok(())
}

fn cached(tokens: &TokenResponse) -> Cached {
    let lifetime = tokens.expires_in.map(Duration::from_secs).unwrap_or(DEFAULT_LIFETIME);
    Cached {
        token: tokens.access_token.clone(),
        until: Instant::now() + lifetime.saturating_sub(EXPIRY_MARGIN),
    }
}

/// iOS suspends an app behind Safari, and with it the loopback listener, so
/// the provider opens in the sign-in sheet instead, which keeps the app
/// running. The redirect still lands on the listener; the sheet is closed
/// once `wait` has it, and closing it first cancels.
#[cfg(target_os = "ios")]
async fn in_sheet<R: Runtime, T>(
    app: &AppHandle<R>,
    url: &str,
    wait: impl std::future::Future<Output = T>
) -> Result<T, String> {
    use tauri_plugin_solstice_native::NativeExt;
    let handle = app.clone();
    let url = url.to_string();
    let sheet = tauri::async_runtime::spawn_blocking(move || handle.native().authenticate(&url));
    let result = tokio::select! {
        done = wait => done,
        _ = sheet => return Err("Sign-in was cancelled.".into()),
    };
    let handle = app.clone();
    let _ = tauri::async_runtime::spawn_blocking(move || handle.native().dismiss_authentication()).await;
    Ok(result)
}

/// True if a sign-in is stored (it may still turn out to be revoked).
pub fn signed_in(issuer: &str, client_id: &str) -> bool {
    matches!(secrets::get(&account(issuer, client_id)), Ok(Some(_)))
}

/// An access token: the one in hand while it lasts, otherwise a fresh one
/// from the stored refresh token. `None` means signed out: nothing stored,
/// or the provider revoked it. Callers at the same moment share a refresh.
pub async fn access_token(issuer: &str, client_id: &str) -> Result<Option<String>, String> {
    let key = account(issuer, client_id);
    let mut cache = TOKENS.lock().await;
    if let Some(c) = cache.get(&key) {
        if Instant::now() < c.until {
            return Ok(Some(c.token.clone()));
        }
    }
    cache.remove(&key);
    let Some(refresh_token) = secrets::get(&key)? else {
        return Ok(None);
    };
    let client = http()?;
    let d = discover(&client, issuer).await?;
    match
        token_request(
            &client,
            &d.token_endpoint,
            &[
                ("grant_type", "refresh_token"),
                ("refresh_token", &refresh_token),
                ("client_id", client_id),
            ]
        ).await
    {
        Ok(tokens) => {
            if let Some(rt) = &tokens.refresh_token {
                // The old one is spent: losing the new one would sign you out.
                secrets::set(&key, rt).or_else(|_| secrets::set(&key, rt))?;
            }
            cache.insert(key, cached(&tokens));
            Ok(Some(tokens.access_token))
        }
        Err((Some(code), _)) if code == "invalid_grant" => {
            // Another copy of the app (a dev build beside the installed one)
            // may have rotated it since we read it: only a token that's still
            // the stored one is gone.
            if secrets::get(&key)?.as_deref() == Some(refresh_token.as_str()) {
                secrets::delete(&key)?;
                return Ok(None);
            }
            Err("The sign-in changed while refreshing it. Trying again.".into())
        }
        // Network trouble: keep the refresh token and let the caller retry.
        Err((_, message)) => Err(message),
    }
}

/// The server turned `token` down (its clock runs ahead, say): the next
/// caller gets a fresh one.
pub async fn refused(issuer: &str, client_id: &str, token: &str) {
    let key = account(issuer, client_id);
    let mut cache = TOKENS.lock().await;
    if cache.get(&key).is_some_and(|c| c.token == token) {
        cache.remove(&key);
    }
}

/// Forgets the sign-in, and asks the provider to revoke it (best effort).
pub async fn sign_out(issuer: &str, client_id: &str) -> Result<(), String> {
    let key = account(issuer, client_id);
    let stored = {
        let mut cache = TOKENS.lock().await;
        cache.remove(&key);
        let stored = secrets::get(&key)?;
        secrets::delete(&key)?;
        stored
    };
    if let Some(rt) = stored {
        if let Ok(client) = http() {
            if let Ok(d) = discover(&client, issuer).await {
                if let Some(endpoint) = d.revocation_endpoint {
                    let _ = client
                        .post(endpoint)
                        .form(
                            &[
                                ("token", rt.as_str()),
                                ("token_type_hint", "refresh_token"),
                                ("client_id", client_id),
                            ]
                        )
                        .send().await;
                }
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn access_tokens_are_kept_until_shortly_before_they_expire() {
        let response = |expires_in| TokenResponse {
            access_token: "a".into(),
            refresh_token: None,
            expires_in,
        };
        let lasts = |expires_in| {
            let before = Instant::now();
            let until = cached(&response(expires_in)).until;
            (until - before, until - Instant::now())
        };
        let (most, least) = lasts(Some(600));
        assert!(most >= Duration::from_secs(540) && least <= Duration::from_secs(540));
        let (most, least) = lasts(None);
        assert!(most >= Duration::from_secs(240) && least <= Duration::from_secs(240));
        // A token that barely lives is refreshed every time.
        assert!(cached(&response(Some(30))).until <= Instant::now());
    }

    #[test]
    fn challenge_matches_rfc_7636() {
        assert_eq!(
            challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
        );
    }

    #[tokio::test]
    async fn catches_the_callback_and_ignores_other_requests() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            let mut seen = vec![];
            for _ in 0..2 {
                let (mut s, _) = listener.accept().await.unwrap();
                seen.push(serve_one(&mut s).await);
            }
            seen
        });

        for path in ["/favicon.ico", "/callback?code=abc&state=xyz"] {
            let mut s = tokio::net::TcpStream::connect(addr).await.unwrap();
            s.write_all(format!("GET {path} HTTP/1.1\r\nHost: x\r\n\r\n").as_bytes()).await.unwrap();
            let mut body = String::new();
            s.read_to_string(&mut body).await.unwrap();
            assert_eq!(body.contains("Signed in"), path.starts_with("/callback"));
        }
        assert_eq!(server.await.unwrap(), vec![None, Some("code=abc&state=xyz".to_string())]);
    }
}
