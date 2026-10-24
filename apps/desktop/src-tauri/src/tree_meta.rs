//! A workspace's bookmarks and folder colors. The rules are
//! `solstice_sync::tree_meta`; this only picks where they're kept. An
//! unlinked folder keeps them in `.solstice/tree.json`. A linked one keeps
//! them in its vault's manifest, through its sync client, which mirrors them
//! to that file and says when another device changed them.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use solstice_sync::{TreeMeta, TreeOp};
use solstice_sync_client::{tree_file, Client};
use specta::Type;
use tauri::AppHandle;
use tauri_specta::Event;

#[derive(Debug, Clone, Serialize, Type)]
pub struct BookmarkEntry {
    pub id: String,
    /// Workspace-relative, `/`-separated.
    pub path: String,
}

#[derive(Debug, Clone, Serialize, Type)]
pub struct TreeMetaState {
    /// Kept in the vault: other devices see changes.
    pub linked: bool,
    /// In order.
    pub bookmarks: Vec<BookmarkEntry>,
    /// Folder path → `#rrggbb`.
    pub folder_colors: BTreeMap<String, String>,
}

/// `TreeOp`, for the frontend's types; the same JSON.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(tag = "op", rename_all = "snake_case")]
pub enum TreeMetaOp {
    AddBookmark { id: String, path: String },
    RemoveBookmark { path: String },
    MoveBookmark { id: String, after: Option<String> },
    SetFolderColor { path: String, color: Option<String> },
    Retarget { from: String, to: String },
    Forget { path: String },
}

impl From<TreeMetaOp> for TreeOp {
    fn from(op: TreeMetaOp) -> Self {
        match op {
            TreeMetaOp::AddBookmark { id, path } => TreeOp::AddBookmark { id, path },
            TreeMetaOp::RemoveBookmark { path } => TreeOp::RemoveBookmark { path },
            TreeMetaOp::MoveBookmark { id, after } => TreeOp::MoveBookmark { id, after },
            TreeMetaOp::SetFolderColor { path, color } => TreeOp::SetFolderColor { path, color },
            TreeMetaOp::Retarget { from, to } => TreeOp::Retarget { from, to },
            TreeMetaOp::Forget { path } => TreeOp::Forget { path },
        }
    }
}

/// A workspace's bookmarks or folder colors changed: ask again.
#[derive(Debug, Clone, Serialize, Deserialize, Type, Event)]
pub struct TreeMetaChanged {
    pub root: String,
}

fn state(meta: TreeMeta, linked: bool) -> TreeMetaState {
    TreeMetaState {
        linked,
        bookmarks: meta.bookmarks.into_iter().map(|b| BookmarkEntry { id: b.id, path: b.path }).collect(),
        folder_colors: meta.folder_colors,
    }
}

/// Two windows may change one unlinked folder's file at once.
static FILE_LOCK: Mutex<()> = Mutex::new(());

fn apply_unlinked(root: &Path, ops: &[TreeOp]) -> Result<TreeMeta, String> {
    let _held = FILE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    tree_file::apply_unlinked(root, ops).map_err(|e| e.to_string())
}

/// A linked folder's client, which starts a moment after the workspace
/// opens.
async fn client(app: &AppHandle, root: &Path) -> Option<Client> {
    for _ in 0..20 {
        if let Some(client) = crate::sync::client_for_root(app, root) {
            return Some(client);
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    None
}

#[tauri::command]
#[specta::specta]
pub async fn tree_meta(app: AppHandle, root: String) -> Result<TreeMetaState, String> {
    let root = PathBuf::from(root);
    if !solstice_sync_client::is_linked(&root) {
        return Ok(state(tree_file::read(&root), false));
    }
    // Not started yet (the frontend asks again on `SyncChanged`, which it
    // sends once it has), or it couldn't: the last mirror, to look at.
    let meta = match crate::sync::client_for_root(&app, &root) {
        Some(client) => client.tree_meta(),
        None => tree_file::read(&root),
    };
    Ok(state(meta, true))
}

/// Changes a workspace's bookmarks or folder colors, and returns them after.
#[tauri::command]
#[specta::specta]
pub async fn tree_meta_apply(app: AppHandle, root: String, ops: Vec<TreeMetaOp>) -> Result<TreeMetaState, String> {
    let ops: Vec<TreeOp> = ops.into_iter().map(Into::into).collect();
    let path = PathBuf::from(&root);
    if solstice_sync_client::is_linked(&path) {
        let client = client(&app, &path).await.ok_or("Sync hasn't started for this workspace yet.")?;
        // The client tells every window through `forward_changes`.
        return client.apply_tree_meta(ops).await.map(|m| state(m, true)).map_err(|e| e.to_string());
    }
    let meta = tokio::task::spawn_blocking(move || apply_unlinked(&path, &ops)).await.map_err(|e| e.to_string())??;
    let _ = TreeMetaChanged { root }.emit(&app);
    Ok(state(meta, false))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ops_are_the_engines_json() {
        let ops = [
            TreeMetaOp::AddBookmark { id: "a".into(), path: "A.md".into() },
            TreeMetaOp::MoveBookmark { id: "a".into(), after: None },
            TreeMetaOp::SetFolderColor { path: "F".into(), color: Some("#ffffff".into()) },
            TreeMetaOp::Retarget { from: "F".into(), to: "G".into() },
            TreeMetaOp::Forget { path: "G".into() },
            TreeMetaOp::RemoveBookmark { path: "A.md".into() },
        ];
        for op in ops {
            let json = serde_json::to_value(&op).unwrap();
            let engine: TreeOp = serde_json::from_value(json.clone()).unwrap();
            assert_eq!(engine, TreeOp::from(op));
            assert_eq!(serde_json::to_value(&engine).unwrap(), json);
        }
    }

    #[test]
    fn an_unlinked_folder_keeps_them_in_its_file() {
        let dir = tempfile::tempdir().unwrap();
        let ops = [TreeOp::AddBookmark { id: "a".into(), path: "Plan.md".into() }];
        apply_unlinked(dir.path(), &ops).unwrap();
        assert!(dir.path().join(".solstice/tree.json").exists());
        assert_eq!(state(tree_file::read(dir.path()), false).bookmarks[0].path, "Plan.md");
    }
}
