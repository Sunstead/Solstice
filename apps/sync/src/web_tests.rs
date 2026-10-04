//! The web app's side of the server, end to end over HTTP: sign-in, the
//! session and its guards, and a vault read and changed through the web
//! routes.

use std::collections::HashMap;
use std::time::Duration;

use futures_util::StreamExt;
use reqwest::{redirect::Policy, Client, StatusCode};
use serde_json::{json, Value};

use crate::auth::oidc::tests::{id_claims, provider, token};
use crate::config::{AuthMode, Config, OidcConfig};

struct Server {
    base: String,
    state: crate::AppState,
    _dir: tempfile::TempDir,
}

async fn serve(auth: AuthMode, public_url: Option<&str>) -> Server {
    let dir = tempfile::tempdir().unwrap();
    let config = Config {
        bind: "127.0.0.1:0".parse().unwrap(),
        notes_dir: dir.path().join("notes"),
        state_dir: dir.path().join("state"),
        public_url: public_url.map(|u| u.parse().unwrap()),
        web_dir: None,
        auth,
    };
    let db = crate::db::Db::open(&config.state_dir).unwrap();
    let state = crate::AppState::new(&config, db);
    state.auth.start();
    let listener = tokio::net::TcpListener::bind(config.bind).await.unwrap();
    let addr = listener.local_addr().unwrap();
    let app = crate::app(state.clone());
    tokio::spawn(async move { axum::serve(listener, app).await });
    Server {
        base: format!("http://{addr}"),
        state,
        _dir: dir,
    }
}

fn client() -> Client {
    Client::builder().redirect(Policy::none()).build().unwrap()
}

/// A request from the web app: the CSRF header on everything.
fn web(c: &Client, method: reqwest::Method, url: String) -> reqwest::RequestBuilder {
    c.request(method, url).header("x-solstice-request", "1")
}

async fn json_of(res: reqwest::Response) -> Value {
    let status = res.status();
    let text = res.text().await.unwrap();
    serde_json::from_str(&text).unwrap_or_else(|_| panic!("{status}: {text}"))
}

#[tokio::test]
async fn a_vault_read_and_changed_from_the_web() {
    let s = serve(
        AuthMode::Dev {
            username: "pwb".into(),
        },
        None,
    )
    .await;
    let c = client();
    let vault = json_of(
        web(&c, reqwest::Method::POST, format!("{}/v1/vaults", s.base))
            .json(&json!({ "name": "Notes" }))
            .send()
            .await
            .unwrap(),
    )
    .await;
    let v = format!("{}/v1/vaults/{}", s.base, vault["id"].as_str().unwrap());
    let op = |body: Value| {
        web(&c, reqwest::Method::POST, format!("{v}/ops"))
            .json(&body)
            .send()
    };

    // A note, read with its base.
    let made = json_of(
        op(json!({ "op": "create_note", "path": "plans/Plan.md", "text": "one\ntwo\n" }))
            .await
            .unwrap(),
    )
    .await;
    assert_eq!(made["path"], "plans/Plan.md");
    let read = json_of(
        c.get(format!("{v}/notes/plans/Plan.md"))
            .send()
            .await
            .unwrap(),
    )
    .await;
    assert_eq!(read["text"], "one\ntwo\n");
    let base = read["base"].as_str().unwrap().to_owned();

    // Two editors saved from the same base: the second keeps the first's edit.
    let save = |text: &str, base: &str| {
        web(&c, reqwest::Method::PUT, format!("{v}/notes/plans/Plan.md"))
            .json(&json!({ "text": text, "base": base }))
            .send()
    };
    let first = json_of(save("ONE\ntwo\n", &base).await.unwrap()).await;
    assert_eq!(first["text"], "ONE\ntwo\n");
    let second = json_of(save("one\ntwo\nthree\n", &base).await.unwrap()).await;
    assert_eq!(second["text"], "ONE\ntwo\nthree\n");

    // A base that isn't one: refused, not guessed at.
    let res = save("x", "garbage").await.unwrap();
    assert_eq!(res.status(), StatusCode::BAD_REQUEST);

    // Watching the vault: a change from elsewhere arrives.
    let ws_url = format!(
        "{}/v1/web/events?vault={}",
        s.base.replace("http", "ws"),
        vault["id"].as_str().unwrap()
    );
    let (mut socket, _) = tokio_tungstenite::connect_async(ws_url).await.unwrap();
    let latest = second["base"].as_str().unwrap().to_owned();
    save("ONE\ntwo\nthree\nfour\n", &latest).await.unwrap();
    let event = tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            if let Some(Ok(tokio_tungstenite::tungstenite::Message::Text(t))) = socket.next().await
            {
                break t.to_string();
            }
        }
    })
    .await
    .expect("no change event");
    let event: Value = serde_json::from_str(&event).unwrap();
    assert_eq!(event["notes"], json!(["plans/Plan.md"]));
    // The file on disk follows.
    let on_disk = s.state.notes_dir.join("pwb/Notes/plans/Plan.md");
    assert_eq!(
        std::fs::read_to_string(on_disk).unwrap(),
        "ONE\ntwo\nthree\nfour\n"
    );

    // Attachments: a new one never replaces another.
    let put = |path: &str, bytes: &'static [u8]| {
        web(&c, reqwest::Method::PUT, format!("{v}/files/{path}?new=1"))
            .body(bytes)
            .send()
    };
    let a = json_of(put("img/a.png", b"first").await.unwrap()).await;
    let b = json_of(put("img/a.png", b"second").await.unwrap()).await;
    assert_eq!(a["path"], "img/a.png");
    assert_eq!(b["path"], "img/a 1.png");
    let got = c.get(format!("{v}/files/img/a.png")).send().await.unwrap();
    assert_eq!(got.headers()["content-type"], "image/png");
    assert_eq!(got.headers()["content-security-policy"], "sandbox");
    assert_eq!(got.bytes().await.unwrap().as_ref(), b"first");

    // Folders, renames, copies and the bin.
    json_of(
        op(json!({ "op": "create_folder", "path": "empty" }))
            .await
            .unwrap(),
    )
    .await;
    json_of(
        op(json!({ "op": "rename", "from": "plans", "to": "projects" }))
            .await
            .unwrap(),
    )
    .await;
    let copy = json_of(
        op(json!({ "op": "duplicate", "path": "projects/Plan.md" }))
            .await
            .unwrap(),
    )
    .await;
    assert_eq!(copy["path"], "projects/Plan copy.md");
    json_of(
        op(json!({ "op": "trash", "path": "img/a 1.png" }))
            .await
            .unwrap(),
    )
    .await;
    let tree = json_of(c.get(format!("{v}/tree")).send().await.unwrap()).await;
    let files: Vec<&str> = tree["files"]
        .as_array()
        .unwrap()
        .iter()
        .map(|f| f["path"].as_str().unwrap())
        .collect();
    assert_eq!(
        files,
        ["img/a.png", "projects/Plan copy.md", "projects/Plan.md"]
    );
    let folders = tree["folders"].as_array().unwrap();
    assert!(folders.contains(&json!("empty")), "{folders:?}");
    assert!(!folders.contains(&json!("plans")), "{folders:?}");

    // Nothing outside the vault, nor its hidden state.
    for bad in [
        "..%2F..%2Fstate%2Fsync.db",
        ".solstice%2Fsync%2Fstate.db",
        "%2Fetc%2Fpasswd",
    ] {
        let res = c.get(format!("{v}/files/{bad}")).send().await.unwrap();
        assert_eq!(res.status(), StatusCode::BAD_REQUEST, "{bad}");
    }
}

#[tokio::test]
async fn a_vault_opened_by_many_requests_at_once_loads_once() {
    let s = serve(
        AuthMode::Dev {
            username: "pwb".into(),
        },
        None,
    )
    .await;
    let folder = s.state.notes_dir.join("pwb/Notes/plans");
    std::fs::create_dir_all(&folder).unwrap();
    std::fs::write(folder.join("Plan.md"), "plan").unwrap();
    std::fs::write(folder.join("../Welcome.md"), "hello").unwrap();
    let c = client();
    // Listing finds the folder and makes it a vault, not yet loaded.
    let vaults = json_of(c.get(format!("{}/v1/vaults", s.base)).send().await.unwrap()).await;
    let id = vaults[0]["id"].as_str().unwrap().to_owned();

    // The web app's first load: several requests at once.
    let first: Vec<_> = (0..8)
        .map(|_| c.get(format!("{}/v1/vaults/{id}/tree", s.base)).send())
        .collect();
    for res in futures_util::future::join_all(first).await {
        assert_eq!(res.unwrap().status(), StatusCode::OK);
    }
    // Every request saw the same notes.
    let tree = json_of(
        c.get(format!("{}/v1/vaults/{id}/tree", s.base))
            .send()
            .await
            .unwrap(),
    )
    .await;
    assert_eq!(tree["files"].as_array().unwrap().len(), 2);
    // And only those were ever stored: one load, one id per file.
    tokio::time::sleep(Duration::from_secs(3)).await;
    let docs = s.state.db.docs(&id).await.unwrap();
    assert_eq!(
        docs.iter().filter(|d| d.doc != "manifest").count(),
        2,
        "{docs:?}"
    );
}

#[tokio::test]
async fn a_save_never_writes_over_an_edit_made_in_the_folder() {
    let s = serve(
        AuthMode::Dev {
            username: "pwb".into(),
        },
        None,
    )
    .await;
    let c = client();
    let vault = json_of(
        web(&c, reqwest::Method::POST, format!("{}/v1/vaults", s.base))
            .json(&json!({ "name": "Notes" }))
            .send()
            .await
            .unwrap(),
    )
    .await;
    let v = format!("{}/v1/vaults/{}", s.base, vault["id"].as_str().unwrap());
    web(&c, reqwest::Method::POST, format!("{v}/ops"))
        .json(&json!({ "op": "create_note", "path": "a.md", "text": "one\ntwo\n" }))
        .send()
        .await
        .unwrap();
    let read = json_of(c.get(format!("{v}/notes/a.md")).send().await.unwrap()).await;

    // Someone edits the file on the server, and before the folder watcher
    // reports it, a save arrives.
    let file = s.state.notes_dir.join("pwb/Notes/a.md");
    std::fs::write(&file, "one\ntwo\nthree, typed on the server\n").unwrap();
    let saved = json_of(
        web(&c, reqwest::Method::PUT, format!("{v}/notes/a.md"))
            .json(&json!({ "text": "ONE\ntwo\n", "base": read["base"] }))
            .send()
            .await
            .unwrap(),
    )
    .await;
    let both = "ONE\ntwo\nthree, typed on the server\n";
    assert_eq!(saved["text"], both);
    assert_eq!(std::fs::read_to_string(&file).unwrap(), both);
}

#[tokio::test]
async fn signing_in_on_the_web() {
    let p = provider("k1").await;
    let auth = AuthMode::Oidc(OidcConfig {
        issuer: p.issuer.clone(),
        client_id: "solstice".into(),
        scopes: "openid profile".into(),
        allowed_groups: vec!["homelab-users".into()],
        discovery_url: None,
    });
    let s = serve(auth, Some("http://solstice.test")).await;
    let c = client();

    // Signed out: no API, and sign-in goes to the provider with PKCE.
    assert_eq!(
        c.get(format!("{}/v1/me", s.base))
            .send()
            .await
            .unwrap()
            .status(),
        StatusCode::UNAUTHORIZED
    );
    let res = c
        .get(format!("{}/auth/login?return_to=%2Fvault%2FNotes", s.base))
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::FOUND);
    let to = url::Url::parse(res.headers()["location"].to_str().unwrap()).unwrap();
    let q: HashMap<_, _> = to.query_pairs().into_owned().collect();
    assert_eq!(q["redirect_uri"], "http://solstice.test/auth/callback");
    assert_eq!(q["code_challenge_method"], "S256");

    // The provider calls back with a token for this sign-in.
    *p.next_id_token.lock().unwrap() = Some(token(
        "k1",
        id_claims(&p.issuer, &q["nonce"], &["homelab-users"]),
    ));
    let res = c
        .get(format!(
            "{}/auth/callback?code=c1&state={}",
            s.base, q["state"]
        ))
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::FOUND);
    assert_eq!(res.headers()["location"], "/vault/Notes");
    let cookie = res.headers()["set-cookie"]
        .to_str()
        .unwrap()
        .split(';')
        .next()
        .unwrap()
        .to_owned();
    assert!(cookie.starts_with("solstice_session="));
    // The state works once.
    let again = c
        .get(format!(
            "{}/auth/callback?code=c1&state={}",
            s.base, q["state"]
        ))
        .send()
        .await
        .unwrap();
    assert_eq!(again.status(), StatusCode::BAD_REQUEST);

    let me = json_of(
        c.get(format!("{}/v1/me", s.base))
            .header("cookie", &cookie)
            .send()
            .await
            .unwrap(),
    )
    .await;
    assert_eq!(me["username"], "pwb");

    // Changes by cookie need the CSRF header, and the server's own origin.
    let create = |csrf: bool, origin: Option<&str>| {
        let mut r = c
            .post(format!("{}/v1/vaults", s.base))
            .header("cookie", &cookie)
            .json(&json!({ "name": "Notes" }));
        if csrf {
            r = r.header("x-solstice-request", "1");
        }
        if let Some(o) = origin {
            r = r.header("origin", o);
        }
        r.send()
    };
    assert_eq!(
        create(false, None).await.unwrap().status(),
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        create(true, Some("https://evil.example"))
            .await
            .unwrap()
            .status(),
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        create(true, Some("http://solstice.test"))
            .await
            .unwrap()
            .status(),
        StatusCode::CREATED
    );

    // Someone else's vault doesn't exist, as far as this session can tell.
    let bob = s.state.db.user_for("iss", "bob", "bob").await.unwrap();
    let theirs = s.state.db.create_vault(bob.id, "Private").await.unwrap();
    let res = c
        .get(format!("{}/v1/vaults/{}/tree", s.base, theirs.id))
        .header("cookie", &cookie)
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::NOT_FOUND);

    // A browser session can't act as a device or make API tokens.
    let res = c
        .get(format!("{}/v1/tokens", s.base))
        .header("cookie", &cookie)
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::FORBIDDEN);

    // The events socket refuses another site's page.
    let mut req =
        tokio_tungstenite::tungstenite::client::IntoClientRequest::into_client_request(format!(
            "{}/v1/web/events?vault={}",
            s.base.replace("http", "ws"),
            theirs.id
        ))
        .unwrap();
    req.headers_mut().insert("cookie", cookie.parse().unwrap());
    req.headers_mut()
        .insert("origin", "https://evil.example".parse().unwrap());
    assert!(tokio_tungstenite::connect_async(req).await.is_err());

    // Signing out ends the session.
    let res = web(&c, reqwest::Method::POST, format!("{}/auth/logout", s.base))
        .header("cookie", &cookie)
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    assert!(res.headers()["set-cookie"]
        .to_str()
        .unwrap()
        .contains("Max-Age=0"));
    let res = c
        .get(format!("{}/v1/me", s.base))
        .header("cookie", &cookie)
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn a_user_outside_the_allowed_groups_gets_no_session() {
    let p = provider("k1").await;
    let auth = AuthMode::Oidc(OidcConfig {
        issuer: p.issuer.clone(),
        client_id: "solstice".into(),
        scopes: "openid profile".into(),
        allowed_groups: vec!["homelab-users".into()],
        discovery_url: None,
    });
    let s = serve(auth, Some("http://solstice.test")).await;
    let c = client();
    let res = c
        .get(format!("{}/auth/login", s.base))
        .send()
        .await
        .unwrap();
    let to = url::Url::parse(res.headers()["location"].to_str().unwrap()).unwrap();
    let q: HashMap<_, _> = to.query_pairs().into_owned().collect();
    *p.next_id_token.lock().unwrap() =
        Some(token("k1", id_claims(&p.issuer, &q["nonce"], &["guests"])));
    let res = c
        .get(format!(
            "{}/auth/callback?code=c&state={}",
            s.base, q["state"]
        ))
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::FORBIDDEN);
    assert!(!res.headers().contains_key("set-cookie"));
}

#[tokio::test]
async fn without_a_public_address_web_sign_in_says_so() {
    let p = provider("k1").await;
    let auth = AuthMode::Oidc(OidcConfig {
        issuer: p.issuer.clone(),
        client_id: "solstice".into(),
        scopes: "openid".into(),
        allowed_groups: vec![],
        discovery_url: None,
    });
    let s = serve(auth, None).await;
    let res = client()
        .get(format!("{}/auth/login", s.base))
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::NOT_IMPLEMENTED);
    assert!(res.text().await.unwrap().contains("SOLSTICE_PUBLIC_URL"));
}
