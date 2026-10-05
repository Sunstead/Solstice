//! Two real folders, linked and kept in sync through a real server running
//! in this process (development sign-in, so no tokens).

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use solstice_sync_client::{link, unlink, Client, NoTokens, Status};
use solstice_sync_server::config::{AuthMode, Config};
use solstice_sync_server::{app, db::Db, AppState};

struct Server {
    url: String,
    state: AppState,
    task: tokio::task::JoinHandle<()>,
}

async fn start_server(root: &Path) -> Server {
    let config = Config {
        bind: "127.0.0.1:0".parse().unwrap(),
        notes_dir: root.join("server/notes"),
        state_dir: root.join("server/state"),
        public_url: None,
        web_dir: None,
        auth: AuthMode::Dev {
            username: "pwb".into(),
        },
    };
    let db = Db::open(&config.state_dir).unwrap();
    let listener = tokio::net::TcpListener::bind(config.bind).await.unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    let state = AppState::new(&config, db);
    let served = state.clone();
    let task = tokio::spawn(async move { axum::serve(listener, app(served)).await.unwrap() });
    Server { url, state, task }
}

impl Server {
    async fn create_vault(&self, name: &str) -> String {
        let server = solstice_sync_client::Server::new(&self.url).unwrap();
        server.create_vault(None, name).await.unwrap().id
    }

    async fn stop(self) {
        self.task.abort();
        let _ = self.task.await;
        self.state.hub.shutdown().await;
    }
}

fn write(folder: &Path, rel: &str, text: &str) {
    let path = folder.join(rel);
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(path, text).unwrap();
}

fn read(folder: &Path, rel: &str) -> Option<String> {
    std::fs::read_to_string(folder.join(rel)).ok()
}

async fn eventually(what: &str, check: impl Fn() -> bool) {
    let deadline = tokio::time::Instant::now() + Duration::from_secs(20);
    while !check() {
        assert!(
            tokio::time::Instant::now() < deadline,
            "timed out waiting for {what}"
        );
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
}

async fn synced(client: &Client) {
    let mut status = client.watch_status();
    let wait = status.wait_for(|s| *s == Status::Synced);
    tokio::time::timeout(Duration::from_secs(20), wait)
        .await
        .expect("synced in time")
        .unwrap();
}

struct Pair {
    _tmp: tempfile::TempDir,
    server: Server,
    a: PathBuf,
    b: PathBuf,
    vault: String,
}

/// Two folders with some files, linked to one vault (A first).
async fn pair() -> (Pair, Client, Client) {
    let tmp = tempfile::tempdir().unwrap();
    let server = start_server(tmp.path()).await;
    let vault = server.create_vault("Notes").await;
    let (a, b) = (tmp.path().join("a"), tmp.path().join("b"));
    write(&a, "From A.md", "written on A\n");
    write(&a, "Shared.md", "A's version\n");
    std::fs::write(a.join("pic.png"), [1u8, 2, 3, 4]).unwrap();
    write(&b, "From B.md", "written on B\n");
    write(&b, "Shared.md", "B's version\n");

    let report = link(&a, &server.url, &vault, "Notes", "laptop", &NoTokens)
        .await
        .unwrap();
    assert_eq!((report.uploaded, report.downloaded), (3, 0));
    let report = link(&b, &server.url, &vault, "Notes", "desktop", &NoTokens)
        .await
        .unwrap();
    assert_eq!(report.downloaded, 2, "{report:?}");
    assert_eq!(report.kept_both, ["Shared (this device).md"]);
    assert!(matches!(
        link(&b, &server.url, &vault, "Notes", "desktop", &NoTokens).await,
        Err(solstice_sync_client::Error::AlreadyLinked)
    ));

    let ca = Client::start(a.clone(), Arc::new(NoTokens)).unwrap();
    let cb = Client::start(b.clone(), Arc::new(NoTokens)).unwrap();
    synced(&ca).await;
    synced(&cb).await;
    (
        Pair {
            _tmp: tmp,
            server,
            a,
            b,
            vault,
        },
        ca,
        cb,
    )
}

#[tokio::test(flavor = "multi_thread")]
async fn linking_keeps_both_versions_and_syncs_the_rest() {
    let (p, ca, cb) = pair().await;
    // B got A's files, and kept its own differing copy beside A's.
    assert_eq!(read(&p.b, "From A.md").as_deref(), Some("written on A\n"));
    assert_eq!(read(&p.b, "Shared.md").as_deref(), Some("A's version\n"));
    assert_eq!(
        read(&p.b, "Shared (this device).md").as_deref(),
        Some("B's version\n")
    );
    assert_eq!(std::fs::read(p.b.join("pic.png")).unwrap(), [1, 2, 3, 4]);
    // A gets B's files once its client runs.
    eventually("B's files on A", || {
        read(&p.a, "From B.md").as_deref() == Some("written on B\n")
            && read(&p.a, "Shared (this device).md").as_deref() == Some("B's version\n")
    })
    .await;
    ca.stop().await;
    cb.stop().await;
    p.server.stop().await;
}

#[tokio::test(flavor = "multi_thread")]
async fn edits_renames_deletes_and_attachments_reach_the_other_folder() {
    let (p, ca, cb) = pair().await;

    write(&p.a, "From A.md", "written on A\nand edited\n");
    eventually("the edit on B", || {
        read(&p.b, "From A.md").as_deref() == Some("written on A\nand edited\n")
    })
    .await;

    write(&p.a, "Folder/New.md", "new on A\n");
    eventually("the new note on B", || {
        read(&p.b, "Folder/New.md").as_deref() == Some("new on A\n")
    })
    .await;

    std::fs::rename(p.a.join("Folder/New.md"), p.a.join("Moved.md")).unwrap();
    eventually("the rename on B", || {
        read(&p.b, "Moved.md").is_some() && read(&p.b, "Folder/New.md").is_none()
    })
    .await;

    std::fs::write(p.b.join("photo.jpg"), b"jpeg bytes").unwrap();
    eventually("the attachment on A", || {
        std::fs::read(p.a.join("photo.jpg")).ok().as_deref() == Some(b"jpeg bytes".as_slice())
    })
    .await;

    std::fs::remove_file(p.a.join("Moved.md")).unwrap();
    eventually("the delete on B", || read(&p.b, "Moved.md").is_none()).await;
    let trash = p.b.join(".solstice/sync/trash");
    assert_eq!(
        std::fs::read_dir(trash).unwrap().count(),
        1,
        "deleted files go to the trash"
    );

    ca.stop().await;
    cb.stop().await;
    p.server.stop().await;
}

#[tokio::test(flavor = "multi_thread")]
async fn a_stale_editor_save_keeps_the_other_devices_edit() {
    let (p, ca, cb) = pair().await;
    // B's editor opens the note.
    cb.editor_opened("From A.md", "written on A\n");
    // A adds a line, which reaches B's file (the editor hasn't reloaded).
    write(&p.a, "From A.md", "written on A\nline from A\n");
    eventually("A's line on B", || {
        read(&p.b, "From A.md").is_some_and(|t| t.contains("line from A"))
    })
    .await;
    // B's editor saves its buffer, which never had A's line.
    write(&p.b, "From A.md", "WRITTEN on A\n");
    cb.saved("From A.md", "WRITTEN on A\n");
    let merged = "WRITTEN on A\nline from A\n";
    eventually("the merge on B", || {
        read(&p.b, "From A.md").as_deref() == Some(merged)
    })
    .await;
    eventually("the merge on A", || {
        read(&p.a, "From A.md").as_deref() == Some(merged)
    })
    .await;
    // A second save from the same stale buffer still keeps A's line.
    write(&p.b, "From A.md", "WRITTEN on A, twice\n");
    cb.saved("From A.md", "WRITTEN on A, twice\n");
    eventually("the second merge on A", || {
        read(&p.a, "From A.md").as_deref() == Some("WRITTEN on A, twice\nline from A\n")
    })
    .await;
    ca.stop().await;
    cb.stop().await;
    p.server.stop().await;
}

#[tokio::test(flavor = "multi_thread")]
async fn overlapping_offline_edits_are_flagged_and_resolved() {
    let (p, ca, cb) = pair().await;
    write(&p.a, "Colour.md", "The colour is red.\n");
    eventually("the note on B", || read(&p.b, "Colour.md").is_some()).await;
    tokio::time::sleep(Duration::from_millis(500)).await;

    // A goes offline and edits; B edits the same word.
    ca.stop().await;
    write(&p.a, "Colour.md", "The color is red.\n");
    write(&p.b, "Colour.md", "The hue is red.\n");
    eventually("B's edit synced", || {
        p.server
            .state
            .notes_dir
            .join("pwb/Notes/Colour.md")
            .exists()
            && std::fs::read_to_string(p.server.state.notes_dir.join("pwb/Notes/Colour.md"))
                .unwrap()
                .contains("hue")
    })
    .await;

    // A comes back: it merges, notices the overlap, and the review syncs.
    let ca = Client::start(p.a.clone(), Arc::new(NoTokens)).unwrap();
    synced(&ca).await;
    let mut reviews = vec![];
    for _ in 0..100 {
        reviews = cb.reviews().await;
        if !reviews.is_empty() {
            break;
        }
        tokio::time::sleep(Duration::from_millis(200)).await;
    }
    assert_eq!(reviews.len(), 1, "{reviews:?}");
    assert_eq!(reviews[0].path.as_deref(), Some("Colour.md"));
    let versions = cb.versions(&reviews[0].id).await.unwrap();
    assert_eq!(versions.local.as_deref(), Some("The color is red.\n"));
    assert_eq!(versions.remote.as_deref(), Some("The hue is red.\n"));

    // Resolving with a chosen text clears it everywhere.
    cb.resolve(&reviews[0].id, Some("The hue is red.\n".into()))
        .await
        .unwrap();
    eventually("the choice on A", || {
        read(&p.a, "Colour.md").as_deref() == Some("The hue is red.\n")
    })
    .await;
    for _ in 0..100 {
        if ca.reviews().await.is_empty() {
            break;
        }
        tokio::time::sleep(Duration::from_millis(200)).await;
    }
    assert!(ca.reviews().await.is_empty());
    ca.stop().await;
    cb.stop().await;
    p.server.stop().await;
}

#[tokio::test(flavor = "multi_thread")]
async fn offline_changes_sync_on_restart_and_unlinking_keeps_files() {
    let (p, ca, cb) = pair().await;
    cb.stop().await;
    write(&p.b, "Offline.md", "made while B was closed\n");
    let cb = Client::start(p.b.clone(), Arc::new(NoTokens)).unwrap();
    synced(&cb).await;
    eventually("the offline note on A", || {
        read(&p.a, "Offline.md").is_some()
    })
    .await;

    ca.stop().await;
    unlink(&p.a).unwrap();
    assert!(!solstice_sync_client::is_linked(&p.a));
    assert_eq!(
        read(&p.a, "Offline.md").as_deref(),
        Some("made while B was closed\n")
    );
    assert!(matches!(
        Client::start(p.a.clone(), Arc::new(NoTokens)),
        Err(solstice_sync_client::Error::NotLinked)
    ));
    let _ = &p.vault;
    cb.stop().await;
    p.server.stop().await;
}

#[tokio::test(flavor = "multi_thread")]
async fn a_vault_deleted_on_the_server_stops_its_folders_and_keeps_their_files() {
    let (p, ca, cb) = pair().await;
    let res = reqwest::Client::new()
        .delete(format!("{}/v1/vaults/{}", p.server.url, p.vault))
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), 204);

    for client in [&ca, &cb] {
        let mut status = client.watch_status();
        let wait = status.wait_for(|s| *s == Status::Deleted);
        tokio::time::timeout(Duration::from_secs(20), wait)
            .await
            .expect("told in time")
            .unwrap();
    }
    // A change made afterwards stays here: nothing reconnects.
    write(&p.a, "After.md", "written after\n");
    ca.reconnect();
    tokio::time::sleep(Duration::from_secs(1)).await;
    assert_eq!(*ca.watch_status().borrow(), Status::Deleted);
    assert_eq!(read(&p.a, "From A.md").as_deref(), Some("written on A\n"));
    assert_eq!(read(&p.b, "From A.md").as_deref(), Some("written on A\n"));
    p.server.stop().await;
}
