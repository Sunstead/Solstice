//! A folder's bookmarks and folder colours on disk: `.solstice/tree.json`.
//! Flat JSON, safe to edit by hand (while the folder isn't linked; then the
//! vault's copy wins and this one only mirrors it), with keys this version
//! doesn't know kept. Order is the bookmarks' order in the array.
//!
//! ```json
//! { "bookmarks": [{ "id": "6f1c…", "path": "notes/Plan.md" }],
//!   "folderColors": { "Projects": "#e5484d" } }
//! ```

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use serde_json::{json, Map, Value};
use solstice_sync::tree_meta::{self, is_bookmark_id};
use solstice_sync::{TreeMeta, TreeOp};

use crate::Error;

fn file(folder: &Path) -> PathBuf {
    folder.join(".solstice").join("tree.json")
}

fn read_object(folder: &Path) -> Map<String, Value> {
    std::fs::read_to_string(file(folder))
        .ok()
        .and_then(|text| serde_json::from_str::<Value>(&text).ok())
        .and_then(|value| match value {
            Value::Object(map) => Some(map),
            _ => None,
        })
        .unwrap_or_default()
}

fn plain_path(path: &str) -> Option<String> {
    solstice_core::VaultPath::parse(path)
        .ok()
        .filter(|p| !p.is_hidden())
        .map(|p| p.to_string())
}

/// What the file holds; a missing or broken file, and entries that aren't
/// valid, read as nothing.
pub fn read(folder: &Path) -> TreeMeta {
    let map = read_object(folder);
    let mut seen = std::collections::HashSet::new();
    let bookmarks: Vec<(String, String)> = map
        .get("bookmarks")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|b| {
            let id = b.get("id")?.as_str()?;
            let path = plain_path(b.get("path")?.as_str()?)?;
            (is_bookmark_id(id) && seen.insert(id.to_string())).then(|| (id.to_string(), path))
        })
        .collect();
    let folder_colors: BTreeMap<String, String> = map
        .get("folderColors")
        .and_then(Value::as_object)
        .into_iter()
        .flatten()
        .filter_map(|(path, color)| {
            Some((
                plain_path(path)?,
                solstice_core::normalize_hex(color.as_str()?)?,
            ))
        })
        .collect();
    TreeMeta::from_ordered(bookmarks, folder_colors)
}

/// Writes `meta` through a temporary file, keeping keys it doesn't own.
pub fn write(folder: &Path, meta: &TreeMeta) -> Result<(), Error> {
    let mut map = read_object(folder);
    let bookmarks: Vec<Value> = meta
        .bookmarks
        .iter()
        .map(|b| json!({ "id": b.id, "path": b.path }))
        .collect();
    map.insert("bookmarks".into(), bookmarks.into());
    map.insert("folderColors".into(), json!(meta.folder_colors));
    let path = file(folder);
    std::fs::create_dir_all(path.parent().expect("has a parent")).map_err(Error::io)?;
    let temp = path.with_extension("json.tmp");
    let text = serde_json::to_string_pretty(&Value::Object(map)).map_err(Error::io)? + "\n";
    std::fs::write(&temp, text).map_err(Error::io)?;
    std::fs::rename(temp, path).map_err(Error::io)
}

/// An unlinked folder's change: read, apply, write.
pub fn apply_unlinked(folder: &Path, ops: &[TreeOp]) -> Result<TreeMeta, Error> {
    let before = read(folder);
    let after = tree_meta::apply(&before, ops)?;
    if after != before {
        write(folder, &after)?;
    }
    Ok(after)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn paths(meta: &TreeMeta) -> Vec<&str> {
        meta.bookmarks.iter().map(|b| b.path.as_str()).collect()
    }

    #[test]
    fn a_missing_or_broken_file_reads_as_empty() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(read(dir.path()), TreeMeta::default());
        std::fs::create_dir_all(dir.path().join(".solstice")).unwrap();
        std::fs::write(file(dir.path()), "{ not json").unwrap();
        assert_eq!(read(dir.path()), TreeMeta::default());
    }

    #[test]
    fn skips_entries_that_are_not_valid() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join(".solstice")).unwrap();
        std::fs::write(
            file(dir.path()),
            r##"{ "bookmarks": [
                  { "id": "a", "path": "A.md" }, { "id": "a", "path": "Again.md" },
                  { "id": "b/c", "path": "B" }, { "id": "d", "path": "../up" },
                  { "id": "e", "path": ".git/x" }, { "id": "f" }, 7 ],
                "folderColors": { "Ok": "#ABC", "Bad": "red", "../up": "#ffffff" } }"##,
        )
        .unwrap();
        let meta = read(dir.path());
        assert_eq!(paths(&meta), ["A.md"]);
        assert_eq!(
            meta.folder_colors,
            BTreeMap::from([("Ok".to_string(), "#aabbcc".to_string())])
        );
    }

    #[test]
    fn keeps_order_and_unknown_keys() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join(".solstice")).unwrap();
        std::fs::write(file(dir.path()), r#"{ "future": 1 }"#).unwrap();
        let ops = [
            TreeOp::AddBookmark {
                id: "a".into(),
                path: "A".into(),
            },
            TreeOp::AddBookmark {
                id: "b".into(),
                path: "B".into(),
            },
            TreeOp::MoveBookmark {
                id: "b".into(),
                after: None,
            },
            TreeOp::SetFolderColor {
                path: "A".into(),
                color: Some("#123456".into()),
            },
        ];
        let meta = apply_unlinked(dir.path(), &ops).unwrap();
        assert_eq!(paths(&meta), ["B", "A"]);
        let again = read(dir.path());
        assert_eq!(paths(&again), ["B", "A"]);
        assert_eq!(again.folder_colors["A"], "#123456");
        let raw: Value =
            serde_json::from_str(&std::fs::read_to_string(file(dir.path())).unwrap()).unwrap();
        assert_eq!(raw["future"], 1);
        assert!(!dir.path().join(".solstice/tree.json.tmp").exists());
    }

    #[test]
    fn a_bad_op_changes_nothing() {
        let dir = tempfile::tempdir().unwrap();
        let ops = [
            TreeOp::AddBookmark {
                id: "a".into(),
                path: "A".into(),
            },
            TreeOp::AddBookmark {
                id: "b".into(),
                path: ".solstice".into(),
            },
        ];
        assert!(apply_unlinked(dir.path(), &ops).is_err());
        assert!(!file(dir.path()).exists());
    }
}
