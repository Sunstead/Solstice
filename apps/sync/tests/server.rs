//! The server end to end: a real listener, real WebSockets, devices running
//! the engine, and the vault folder on disk.

use std::path::{Path, PathBuf};
use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use solstice_sync::{content_hash, Content, Event, Frame, Session, Vault};
use solstice_sync_server::config::{AuthMode, Config};
use solstice_sync_server::{app, db::Db, AppState};
use tokio::net::TcpStream;
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::{MaybeTlsStream, WebSocketStream};

struct Server {
    base: String,
    notes: PathBuf,
    state_dir: PathBuf,
    task: tokio::task::JoinHandle<()>,
    state: AppState,
}

async fn start(root: &Path) -> Server {
    let config = Config {
        bind: "127.0.0.1:0".parse().unwrap(),
        notes_dir: root.join("notes"),
        state_dir: root.join("state"),
        auth: AuthMode::Dev {
            username: "pwb".into(),
        },
    };
    let db = Db::open(&config.state_dir).unwrap();
    let listener = tokio::net::TcpListener::bind(config.bind).await.unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    let state = AppState::new(&config, db);
    let served = state.clone();
    let task = tokio::spawn(async move { axum::serve(listener, app(served)).await.unwrap() });
    Server {
        base,
        notes: config.notes_dir,
        state_dir: config.state_dir,
        task,
        state,
    }
}

impl Server {
    /// Stops serving and every vault task (which save first), and lets go
    /// of the database.
    async fn stop(self) {
        self.task.abort();
        let _ = self.task.await;
        self.state.hub.shutdown().await;
    }

    async fn create_vault(&self, name: &str) -> String {
        let res = reqwest::Client::new()
            .post(format!("{}/v1/vaults", self.base))
            .json(&serde_json::json!({ "name": name }))
            .send()
            .await
            .unwrap();
        assert_eq!(res.status(), 201);
        res.json::<serde_json::Value>().await.unwrap()["id"]
            .as_str()
            .unwrap()
            .to_string()
    }

    fn file(&self, rel: &str) -> Option<String> {
        std::fs::read_to_string(self.notes.join("pwb").join("Notes").join(rel)).ok()
    }
}

type Socket = WebSocketStream<MaybeTlsStream<TcpStream>>;

struct Device {
    vault_id: String,
    vault: Vault,
    session: Session,
    socket: Option<Socket>,
    events: Vec<Event>,
    notices: Vec<String>,
}

impl Device {
    fn new(name: &str, vault_id: &str) -> Self {
        Self {
            vault_id: vault_id.into(),
            vault: Vault::new(name),
            session: Session::device(),
            socket: None,
            events: vec![],
            notices: vec![],
        }
    }

    async fn connect(&mut self, server: &Server) {
        let url = format!("{}/v1/sync", server.base.replace("http", "ws"));
        let (socket, _) = tokio_tungstenite::connect_async(url).await.unwrap();
        self.socket = Some(socket);
        let open = self.session.open(&self.vault);
        self.send(open).await;
        self.settle().await;
    }

    fn disconnect(&mut self) {
        self.socket = None;
    }

    async fn send(&mut self, msgs: Vec<solstice_sync::Msg>) {
        if msgs.is_empty() {
            return;
        }
        if let Some(socket) = self.socket.as_mut() {
            let frame = Frame::new(&self.vault_id, msgs).encode();
            socket.send(Message::Binary(frame.into())).await.unwrap();
        }
    }

    /// Handles one message from the server, if one arrives in time.
    async fn step(&mut self, wait: Duration) -> bool {
        let Some(socket) = self.socket.as_mut() else {
            return false;
        };
        let msg = match tokio::time::timeout(wait, socket.next()).await {
            Ok(Some(Ok(msg))) => msg,
            _ => return false,
        };
        match msg {
            Message::Binary(bytes) => {
                let frame = Frame::decode(&bytes).unwrap();
                let mut replies = vec![];
                for msg in frame.msgs {
                    let out = self.session.receive(&mut self.vault, msg).unwrap();
                    replies.extend(out.replies);
                    self.events.extend(out.events);
                }
                self.send(replies).await;
            }
            Message::Text(text) => self.notices.push(text.to_string()),
            _ => {}
        }
        true
    }

    /// Exchanges messages until the server goes quiet.
    async fn settle(&mut self) {
        while self.step(Duration::from_millis(400)).await {}
    }

    /// Exchanges messages until `done` holds, or fails after a while.
    async fn wait_for(&mut self, what: &str, done: impl Fn(&Vault) -> bool) {
        let deadline = tokio::time::Instant::now() + Duration::from_secs(15);
        while !done(&self.vault) {
            assert!(
                tokio::time::Instant::now() < deadline,
                "timed out waiting for {what}"
            );
            self.step(Duration::from_millis(200)).await;
        }
    }

    fn text(&self, path: &str) -> Option<String> {
        match self.vault.files().get(path) {
            Some((_, Content::Note(t))) => Some(t.clone()),
            _ => None,
        }
    }
}

async fn eventually(what: &str, check: impl Fn() -> bool) {
    let deadline = tokio::time::Instant::now() + Duration::from_secs(15);
    while !check() {
        assert!(
            tokio::time::Instant::now() < deadline,
            "timed out waiting for {what}"
        );
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
}

#[tokio::test]
async fn devices_sync_through_the_server_and_its_folder() {
    let tmp = tempfile::tempdir().unwrap();
    let server = start(tmp.path()).await;
    let vault = server.create_vault("Notes").await;

    // A writes a note offline, then connects: it reaches the server's folder.
    let mut a = Device::new("laptop", &vault);
    let (id, _) = a.vault.create_note("Plans/Trip.md", "# Trip\n").unwrap();
    a.connect(&server).await;
    eventually("the note on disk", || {
        server.file("Plans/Trip.md").as_deref() == Some("# Trip\n")
    })
    .await;

    // B connects and gets it.
    let mut b = Device::new("phone", &vault);
    b.connect(&server).await;
    b.wait_for("the note on B", |v| v.files().contains_key("Plans/Trip.md"))
        .await;

    // Live: A edits, B sees it, and so does the folder.
    let msgs = a
        .vault
        .save_note(&id, "# Trip\n\n- passport\n", None)
        .unwrap();
    a.send(msgs).await;
    b.wait_for("A's live edit", |v| {
        v.note(&id).is_some_and(|n| n.text().contains("passport"))
    })
    .await;
    eventually("the edit on disk", || {
        server
            .file("Plans/Trip.md")
            .is_some_and(|t| t.contains("passport"))
    })
    .await;

    // Editing the file on the server reaches both devices.
    std::fs::write(
        server.notes.join("pwb/Notes/Plans/Trip.md"),
        "# Trip\n\n- passport\n- tickets\n",
    )
    .unwrap();
    a.wait_for("the server-side edit on A", |v| {
        v.note(&id).is_some_and(|n| n.text().contains("tickets"))
    })
    .await;
    b.wait_for("the server-side edit on B", |v| {
        v.note(&id).is_some_and(|n| n.text().contains("tickets"))
    })
    .await;

    // A file added on the server becomes a note everywhere.
    std::fs::write(server.notes.join("pwb/Notes/Inbox.md"), "dropped in").unwrap();
    a.wait_for("the new file on A", |v| v.files().contains_key("Inbox.md"))
        .await;

    // Renames made by a device move the file.
    let msgs = a.vault.rename(&id, "Trip.md").unwrap();
    a.send(msgs).await;
    eventually("the rename on disk", || {
        server.file("Trip.md").is_some() && server.file("Plans/Trip.md").is_none()
    })
    .await;
    b.wait_for("the rename on B", |v| v.files().contains_key("Trip.md"))
        .await;
    assert!(
        a.notices.is_empty() && b.notices.is_empty(),
        "{:?} {:?}",
        a.notices,
        b.notices
    );
    server.stop().await;
}

#[tokio::test]
async fn offline_edits_on_two_devices_merge_and_overlaps_are_flagged() {
    let tmp = tempfile::tempdir().unwrap();
    let server = start(tmp.path()).await;
    let vault = server.create_vault("Notes").await;
    let mut a = Device::new("laptop", &vault);
    let mut b = Device::new("phone", &vault);
    let (id, _) = a
        .vault
        .create_note("Colour.md", "The colour is red.\n\nSecond line.\n")
        .unwrap();
    a.connect(&server).await;
    b.connect(&server).await;
    a.disconnect();
    b.disconnect();

    a.vault
        .save_note(&id, "The color is red.\n\nSecond line.\n", None)
        .unwrap();
    b.vault
        .save_note(&id, "The hue is red.\n\nSecond line, from B.\n", None)
        .unwrap();
    a.connect(&server).await;
    b.connect(&server).await;
    a.settle().await;

    assert_eq!(a.text("Colour.md"), b.text("Colour.md"));
    assert!(b.events.contains(&Event::Review(id.clone())));
    a.wait_for("the review on A", |v| {
        v.manifest.reviews().contains_key(&id)
    })
    .await;
    eventually("the merge on disk", || {
        server.file("Colour.md") == a.text("Colour.md")
    })
    .await;
    server.stop().await;
}

#[tokio::test]
async fn attachments_upload_and_land_in_the_folder() {
    let tmp = tempfile::tempdir().unwrap();
    let server = start(tmp.path()).await;
    let vault = server.create_vault("Notes").await;
    let bytes = b"\x89PNG not really".to_vec();
    let hash = content_hash(&bytes);
    let http = reqwest::Client::new();
    let url = format!("{}/v1/vaults/{vault}/blobs/{hash}", server.base);

    let res = http.put(&url).body(b"wrong".to_vec()).send().await.unwrap();
    assert_eq!(res.status(), 400, "content must match its hash");
    let res = http.put(&url).body(bytes.clone()).send().await.unwrap();
    assert_eq!(res.status(), 204);

    let mut a = Device::new("laptop", &vault);
    a.vault.create_blob("img/pic.png", &hash).unwrap();
    a.connect(&server).await;
    let path = server.notes.join("pwb/Notes/img/pic.png");
    eventually("the attachment on disk", || {
        std::fs::read(&path).ok().as_deref() == Some(bytes.as_slice())
    })
    .await;
    assert_eq!(
        http.get(&url)
            .send()
            .await
            .unwrap()
            .bytes()
            .await
            .unwrap()
            .to_vec(),
        bytes
    );
    server.stop().await;
}

#[tokio::test]
async fn api_tokens_create_notes_and_nothing_else() {
    let tmp = tempfile::tempdir().unwrap();
    let server = start(tmp.path()).await;
    let vault = server.create_vault("Notes").await;
    let http = reqwest::Client::new();

    let res = http
        .post(format!("{}/v1/tokens", server.base))
        .json(&serde_json::json!({ "name": "Atlas" }))
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), 201);
    let token = res.json::<serde_json::Value>().await.unwrap()["token"]
        .as_str()
        .unwrap()
        .to_string();

    let mut a = Device::new("laptop", &vault);
    a.connect(&server).await;

    let res = http
        .post(format!("{}/v1/vaults/{vault}/notes", server.base))
        .bearer_auth(&token)
        .json(&serde_json::json!({ "path": "From Atlas.md", "text": "saved from search" }))
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), 201);
    a.wait_for("Atlas's note on the device", |v| {
        v.files().contains_key("From Atlas.md")
    })
    .await;
    assert_eq!(
        server.file("From Atlas.md").as_deref(),
        Some("saved from search")
    );

    // The same path again lands beside it, numbered.
    let res = http
        .post(format!("{}/v1/vaults/{vault}/notes", server.base))
        .bearer_auth(&token)
        .json(&serde_json::json!({ "path": "From Atlas.md", "text": "again" }))
        .send()
        .await
        .unwrap();
    let body = res.json::<serde_json::Value>().await.unwrap();
    assert_eq!(body["path"], "From Atlas 1.md");

    let list = http
        .get(format!("{}/v1/vaults", server.base))
        .bearer_auth(&token)
        .send()
        .await
        .unwrap();
    assert_eq!(list.status(), 200);
    for (method, path) in [("POST", "/v1/vaults"), ("GET", "/v1/tokens")] {
        let res = http
            .request(method.parse().unwrap(), format!("{}{path}", server.base))
            .bearer_auth(&token)
            .json(&serde_json::json!({ "name": "x" }))
            .send()
            .await
            .unwrap();
        assert_eq!(res.status(), 403, "{method} {path}");
    }
    let bad = http
        .get(format!("{}/v1/vaults", server.base))
        .bearer_auth("sst_nope")
        .send()
        .await
        .unwrap();
    assert_eq!(bad.status(), 401);
    let not_md = http
        .post(format!("{}/v1/vaults/{vault}/notes", server.base))
        .bearer_auth(&token)
        .json(&serde_json::json!({ "path": "x.txt" }))
        .send()
        .await
        .unwrap();
    assert_eq!(not_md.status(), 400);
    server.stop().await;
}

#[tokio::test]
async fn a_restart_keeps_state_and_lost_state_asks_devices_to_relink() {
    let tmp = tempfile::tempdir().unwrap();
    let server = start(tmp.path()).await;
    let vault = server.create_vault("Notes").await;
    let mut a = Device::new("laptop", &vault);
    let (id, _) = a.vault.create_note("Keep.md", "kept\n").unwrap();
    a.connect(&server).await;
    eventually("the note on disk", || server.file("Keep.md").is_some()).await;
    server.stop().await;
    a.disconnect();

    // Same folders, new process: the device reconnects with nothing new.
    let server = start(tmp.path()).await;
    a.connect(&server).await;
    assert_eq!(a.text("Keep.md").as_deref(), Some("kept\n"));
    assert!(!a.events.contains(&Event::Relink));
    let msgs = a.vault.save_note(&id, "kept\nand edited\n", None).unwrap();
    a.send(msgs).await;
    eventually("the edit on disk", || {
        server.file("Keep.md").as_deref() == Some("kept\nand edited\n")
    })
    .await;
    let state_dir = server.state_dir.clone();
    a.disconnect();
    server.stop().await;

    // The state database is lost; the folder survives. The vault comes back
    // from its folder under a new id, and a device with the old id is told
    // the vault is unknown (so it links again). (The closed connection's
    // task lets go of the database a moment later.)
    eventually("the database to be deletable", || {
        std::fs::remove_dir_all(&state_dir).is_ok()
    })
    .await;
    let server = start(tmp.path()).await;
    let list: Vec<serde_json::Value> = reqwest::get(format!("{}/v1/vaults", server.base))
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(list.len(), 1, "the folder became a vault again");
    let new_id = list[0]["id"].as_str().unwrap().to_string();
    assert_ne!(new_id, vault);
    a.connect(&server).await;
    assert!(
        a.notices.iter().any(|n| n.contains("unknown_vault")),
        "{:?}",
        a.notices
    );
    let mut fresh = Device::new("laptop again", &new_id);
    fresh.connect(&server).await;
    assert_eq!(fresh.text("Keep.md").as_deref(), Some("kept\nand edited\n"));
    assert!(fresh.notices.is_empty(), "{:?}", fresh.notices);
    server.stop().await;
}
