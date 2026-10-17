//! A workspace's own metadata, `.solstice/workspace.json`: its color, for the
//! workspace icon. Flat JSON so it's safe to edit by hand; keys this version
//! doesn't know are kept.
//!
//! `.solstice/` never syncs, so a linked folder's color travels as its vault's
//! on the server: a color picked here is pushed (and marked `colorPending`
//! until the server has it), and one changed elsewhere is adopted when the
//! frontend asks (`sync_pull_colors`).

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use serde::Serialize;
use serde_json::{Map, Value};
use solstice_sync_client::Server;
use specta::Type;

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Type)]
pub struct WorkspaceMeta {
    /// `#rrggbb`, or none: the frontend makes one from the name.
    pub color: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
struct Stored {
    color: Option<String>,
    /// Picked here, and not on the server yet.
    pending: bool,
}

fn meta_file(dir: &Path) -> PathBuf {
    dir.join(".solstice").join("workspace.json")
}

fn read_object(dir: &Path) -> Map<String, Value> {
    std::fs::read_to_string(meta_file(dir))
        .ok()
        .and_then(|text| serde_json::from_str::<Value>(&text).ok())
        .and_then(|value| match value {
            Value::Object(map) => Some(map),
            _ => None,
        })
        .unwrap_or_default()
}

/// A missing or unreadable file, or a color that isn't one, reads as none.
fn read_stored(dir: &Path) -> Stored {
    let map = read_object(dir);
    Stored {
        color: map
            .get("color")
            .and_then(Value::as_str)
            .and_then(solstice_core::normalize_hex),
        pending: map.get("colorPending").and_then(Value::as_bool).unwrap_or(false),
    }
}

fn write_stored(dir: &Path, stored: &Stored) -> std::io::Result<()> {
    let mut map = read_object(dir);
    match &stored.color {
        Some(color) => map.insert("color".into(), color.clone().into()),
        None => map.remove("color"),
    };
    if stored.pending {
        map.insert("colorPending".into(), true.into());
    } else {
        map.remove("colorPending");
    }
    let file = meta_file(dir);
    std::fs::create_dir_all(file.parent().expect("has a parent"))?;
    let temp = file.with_extension("json.tmp");
    std::fs::write(&temp, serde_json::to_string_pretty(&Value::Object(map))? + "\n")?;
    std::fs::rename(temp, file)
}

impl From<Stored> for WorkspaceMeta {
    fn from(stored: Stored) -> Self {
        Self { color: stored.color }
    }
}

#[derive(Debug, PartialEq, Eq)]
enum Reconcile {
    /// The server should have ours.
    Push(Option<String>),
    /// Ours should be the server's.
    Adopt(Option<String>),
    Keep,
}

/// A color picked here wins until the server has it; otherwise the server's
/// is the latest anyone picked, a cleared one included.
fn reconcile(local: &Stored, server: Option<&str>) -> Reconcile {
    if local.pending {
        Reconcile::Push(local.color.clone())
    } else if local.color.as_deref() != server {
        Reconcile::Adopt(server.map(str::to_owned))
    } else {
        Reconcile::Keep
    }
}

/// Each workspace's metadata, open or not.
#[tauri::command]
#[specta::specta]
pub async fn workspace_meta(paths: Vec<String>) -> Vec<WorkspaceMeta> {
    tokio::task::spawn_blocking(move || {
        paths.iter().map(|p| read_stored(Path::new(p)).into()).collect()
    })
    .await
    .unwrap_or_default()
}

/// Sets (or, with `None`, clears) a workspace's color, and its vault's if
/// it's linked. Offline, the server catches up on the next `sync_pull_colors`.
#[tauri::command]
#[specta::specta]
pub async fn set_workspace_color(path: String, color: Option<String>) -> Result<WorkspaceMeta, String> {
    let color = match color {
        Some(c) => Some(solstice_core::normalize_hex(&c).ok_or_else(|| format!("{c:?} isn't a color"))?),
        None => None,
    };
    let dir = PathBuf::from(&path);
    let stored = Stored { color, pending: true };
    write_stored(&dir, &stored).map_err(|e| e.to_string())?;
    if let Ok(link) = solstice_sync_client::read_link(&dir) {
        if push(&link.server, &link.vault_id, stored.color.as_deref()).await.is_ok() {
            let _ = write_stored(&dir, &Stored { pending: false, ..stored.clone() });
        }
    }
    Ok(stored.into())
}

/// Brings linked workspaces' colors in step with their vaults (one request
/// per server), then returns every workspace's metadata. Servers that can't
/// be reached leave theirs as they were.
#[tauri::command]
#[specta::specta]
pub async fn sync_pull_colors(paths: Vec<String>) -> Vec<WorkspaceMeta> {
    let mut by_server: BTreeMap<String, Vec<(PathBuf, String)>> = BTreeMap::new();
    for path in &paths {
        let dir = PathBuf::from(path);
        if let Ok(link) = solstice_sync_client::read_link(&dir) {
            by_server.entry(link.server).or_default().push((dir, link.vault_id));
        }
    }
    for (server, folders) in by_server {
        let Ok(vaults) = vaults(&server).await else { continue };
        for (dir, vault_id) in folders {
            let Some(vault) = vaults.iter().find(|v| v.id == vault_id) else { continue };
            let local = read_stored(&dir);
            match reconcile(&local, vault.color.as_deref()) {
                Reconcile::Push(color) => {
                    if push(&server, &vault_id, color.as_deref()).await.is_ok() {
                        let _ = write_stored(&dir, &Stored { color, pending: false });
                    }
                }
                Reconcile::Adopt(color) => {
                    let _ = write_stored(&dir, &Stored { color, pending: false });
                }
                Reconcile::Keep => {}
            }
        }
    }
    workspace_meta(paths).await
}

async fn vaults(server: &str) -> Result<Vec<solstice_sync_client::VaultInfo>, String> {
    let token = crate::sync::token(server).await?;
    Server::new(server)
        .map_err(|e| e.to_string())?
        .vaults(token.as_deref())
        .await
        .map_err(|e| e.to_string())
}

async fn push(server: &str, vault_id: &str, color: Option<&str>) -> Result<(), String> {
    let token = crate::sync::token(server).await?;
    Server::new(server)
        .map_err(|e| e.to_string())?
        .set_vault_color(token.as_deref(), vault_id, color)
        .await
        .map(drop)
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn stored(color: Option<&str>, pending: bool) -> Stored {
        Stored { color: color.map(str::to_owned), pending }
    }

    #[test]
    fn a_missing_or_broken_file_reads_as_no_color() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(read_stored(dir.path()), Stored::default());
        std::fs::create_dir_all(dir.path().join(".solstice")).unwrap();
        for broken in ["not json", "[1]", r#"{"color": "blue"}"#, r#"{"color": 7}"#] {
            std::fs::write(meta_file(dir.path()), broken).unwrap();
            assert_eq!(read_stored(dir.path()), Stored::default(), "{broken}");
        }
    }

    #[test]
    fn writing_keeps_keys_it_does_not_know() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join(".solstice")).unwrap();
        std::fs::write(meta_file(dir.path()), r##"{"color": "#ABC", "icon": "moon"}"##).unwrap();
        assert_eq!(read_stored(dir.path()), stored(Some("#aabbcc"), false));

        write_stored(dir.path(), &stored(Some("#4f7cc4"), true)).unwrap();
        assert_eq!(read_stored(dir.path()), stored(Some("#4f7cc4"), true));
        write_stored(dir.path(), &stored(None, false)).unwrap();
        assert_eq!(read_stored(dir.path()), Stored::default());
        let left: Value = serde_json::from_str(&std::fs::read_to_string(meta_file(dir.path())).unwrap()).unwrap();
        assert_eq!(left, serde_json::json!({ "icon": "moon" }));
    }

    #[test]
    fn writing_makes_the_folder() {
        let dir = tempfile::tempdir().unwrap();
        write_stored(dir.path(), &stored(Some("#4f7cc4"), false)).unwrap();
        assert_eq!(read_stored(dir.path()).color.as_deref(), Some("#4f7cc4"));
    }

    #[test]
    fn a_color_picked_here_wins_until_the_server_has_it() {
        assert_eq!(
            reconcile(&stored(Some("#111111"), true), Some("#222222")),
            Reconcile::Push(Some("#111111".into()))
        );
        assert_eq!(reconcile(&stored(None, true), Some("#222222")), Reconcile::Push(None));
    }

    #[test]
    fn otherwise_the_server_has_the_latest() {
        assert_eq!(
            reconcile(&stored(Some("#111111"), false), Some("#222222")),
            Reconcile::Adopt(Some("#222222".into()))
        );
        assert_eq!(reconcile(&stored(Some("#111111"), false), None), Reconcile::Adopt(None));
        assert_eq!(reconcile(&stored(None, false), Some("#222222")), Reconcile::Adopt(Some("#222222".into())));
        assert_eq!(reconcile(&stored(Some("#111111"), false), Some("#111111")), Reconcile::Keep);
        assert_eq!(reconcile(&stored(None, false), None), Reconcile::Keep);
    }
}
