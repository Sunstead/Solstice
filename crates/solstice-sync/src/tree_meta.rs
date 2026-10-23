//! A vault's bookmarks and folder colors: what the desktop keeps in
//! `.solstice/tree.json`, and a synced vault in two maps of its manifest.
//!
//! [`apply`] is the one place the ops' rules live; the manifest and the
//! file only store the result. Bookmarks are ordered by fractional keys
//! ([`order`]), so a move writes one key and two devices' moves merge.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::vault::checked;
use crate::Error;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Bookmark {
    pub id: String,
    /// Vault-relative, `/`-separated; a file or a folder.
    pub path: String,
    /// A key from [`order`]; bookmarks sort by `(order, id)`.
    pub order: String,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct TreeMeta {
    /// In display order.
    pub bookmarks: Vec<Bookmark>,
    /// Folder path → `#rrggbb`.
    pub folder_colors: BTreeMap<String, String>,
}

/// A change to a vault's bookmarks or folder colors. Paths are
/// vault-relative; the desktop and the web send the same JSON.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "op", rename_all = "snake_case")]
pub enum TreeOp {
    /// At the end; nothing if the path is bookmarked already.
    AddBookmark {
        id: String,
        path: String,
    },
    /// Every bookmark at the path (two devices may have added one offline).
    RemoveBookmark {
        path: String,
    },
    /// After `after`, or first when `None`; to the end if `after` is unknown.
    MoveBookmark {
        id: String,
        after: Option<String>,
    },
    SetFolderColor {
        path: String,
        color: Option<String>,
    },
    /// A rename or move: the path and everything under it.
    Retarget {
        from: String,
        to: String,
    },
    /// A delete: the path and everything under it.
    Forget {
        path: String,
    },
}

/// Ids name manifest keys (`<id>/path`), so no `/`.
pub fn is_bookmark_id(id: &str) -> bool {
    (1..=64).contains(&id.len()) && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
}

/// `path` with `from` swapped for `to`, if it is `from` or under it.
pub fn retarget_path(path: &str, from: &str, to: &str) -> Option<String> {
    if path == from {
        return Some(to.to_string());
    }
    let rest = path.strip_prefix(from)?.strip_prefix('/')?;
    Some(format!("{to}/{rest}"))
}

fn within(path: &str, folder: &str) -> bool {
    retarget_path(path, folder, folder).is_some()
}

impl TreeMeta {
    /// Bookmarks in the given order, given fresh keys.
    pub fn from_ordered(
        bookmarks: impl IntoIterator<Item = (String, String)>,
        folder_colors: BTreeMap<String, String>,
    ) -> Self {
        let bookmarks: Vec<(String, String)> = bookmarks.into_iter().collect();
        let keys = order::spread(bookmarks.len());
        Self {
            bookmarks: bookmarks
                .into_iter()
                .zip(keys)
                .map(|((id, path), order)| Bookmark { id, path, order })
                .collect(),
            folder_colors,
        }
    }

    pub fn sort(&mut self) {
        self.bookmarks
            .sort_by(|a, b| (&a.order, &a.id).cmp(&(&b.order, &b.id)));
    }
}

/// `meta` with `ops` applied in turn. A bad path, id or color fails the
/// whole batch.
pub fn apply(meta: &TreeMeta, ops: &[TreeOp]) -> Result<TreeMeta, Error> {
    let mut out = meta.clone();
    out.sort();
    for op in ops {
        step(&mut out, op)?;
    }
    Ok(out)
}

fn step(meta: &mut TreeMeta, op: &TreeOp) -> Result<(), Error> {
    match op {
        TreeOp::AddBookmark { id, path } => {
            if !is_bookmark_id(id) {
                return Err(Error::BookmarkId(id.clone()));
            }
            let path = checked(path)?;
            if meta.bookmarks.iter().any(|b| b.path == path || b.id == *id) {
                return Ok(());
            }
            meta.bookmarks.push(Bookmark {
                id: id.clone(),
                path,
                order: String::new(),
            });
            place(meta, meta.bookmarks.len() - 1);
        }
        TreeOp::RemoveBookmark { path } => {
            let path = checked(path)?;
            meta.bookmarks.retain(|b| b.path != path);
        }
        TreeOp::MoveBookmark { id, after } => {
            let Some(from) = meta.bookmarks.iter().position(|b| b.id == *id) else {
                return Ok(());
            };
            let bookmark = meta.bookmarks.remove(from);
            let to = match after {
                None => 0,
                Some(after) => meta
                    .bookmarks
                    .iter()
                    .position(|b| b.id == *after)
                    .map_or(meta.bookmarks.len(), |i| i + 1),
            };
            meta.bookmarks.insert(to, bookmark);
            place(meta, to);
        }
        TreeOp::SetFolderColor { path, color } => {
            let path = checked(path)?;
            match color {
                Some(color) => {
                    let hex = solstice_core::normalize_hex(color)
                        .ok_or_else(|| Error::Color(color.clone()))?;
                    meta.folder_colors.insert(path, hex);
                }
                None => {
                    meta.folder_colors.remove(&path);
                }
            }
        }
        TreeOp::Retarget { from, to } => {
            let (from, to) = (checked(from)?, checked(to)?);
            for bookmark in &mut meta.bookmarks {
                if let Some(path) = retarget_path(&bookmark.path, &from, &to) {
                    bookmark.path = path;
                }
            }
            let colors = std::mem::take(&mut meta.folder_colors);
            for (path, color) in colors {
                let path = retarget_path(&path, &from, &to).unwrap_or(path);
                meta.folder_colors.insert(path, color);
            }
        }
        TreeOp::Forget { path } => {
            let path = checked(path)?;
            meta.bookmarks.retain(|b| !within(&b.path, &path));
            meta.folder_colors.retain(|p, _| !within(p, &path));
        }
    }
    Ok(())
}

/// Gives the bookmark at `at` a key between its neighbours'. Neighbours
/// with clashing or broken keys (from two devices, or a hand-edited peer)
/// leave no room, so then every bookmark gets a fresh key.
fn place(meta: &mut TreeMeta, at: usize) {
    let lo = at.checked_sub(1).map(|i| meta.bookmarks[i].order.as_str());
    let hi = meta.bookmarks.get(at + 1).map(|b| b.order.as_str());
    match order::between(lo, hi) {
        Some(key) => meta.bookmarks[at].order = key,
        None => {
            let keys = order::spread(meta.bookmarks.len());
            for (bookmark, key) in meta.bookmarks.iter_mut().zip(keys) {
                bookmark.order = key;
            }
        }
    }
}

/// Fractional order keys: strings of base-62 digits read as a fraction, so
/// there's always another between two (rocicorp's fractional-indexing,
/// without its integer part). No key ends in `0`, the smallest digit.
pub mod order {
    const DIGITS: &[u8] = b"0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
    const BASE: usize = DIGITS.len();

    fn digits(key: &str) -> Option<Vec<usize>> {
        let out: Option<Vec<usize>> = key
            .bytes()
            .map(|c| DIGITS.iter().position(|&d| d == c))
            .collect();
        out.filter(|d| d.last().is_some_and(|&last| last != 0))
    }

    /// A key after `lo` and before `hi` (either end open), or `None` if
    /// they aren't keys or leave no room (`lo >= hi`).
    pub fn between(lo: Option<&str>, hi: Option<&str>) -> Option<String> {
        let lo = match lo {
            Some(lo) => digits(lo)?,
            None => vec![],
        };
        let hi = match hi {
            Some(hi) => Some(digits(hi)?),
            None => None,
        };
        if hi.as_ref().is_some_and(|hi| lo >= *hi) {
            return None;
        }
        let key = midpoint(&lo, hi.as_deref());
        Some(key.into_iter().map(|d| DIGITS[d] as char).collect())
    }

    fn midpoint(lo: &[usize], hi: Option<&[usize]>) -> Vec<usize> {
        if let Some(hi) = hi {
            let shared = hi
                .iter()
                .enumerate()
                .take_while(|&(i, &d)| lo.get(i).copied().unwrap_or(0) == d)
                .count();
            if shared > 0 {
                let mut out = hi[..shared].to_vec();
                out.extend(midpoint(
                    lo.get(shared..).unwrap_or(&[]),
                    Some(&hi[shared..]),
                ));
                return out;
            }
        }
        let first = lo.first().copied().unwrap_or(0);
        match hi {
            Some(hi) => {
                if hi[0] - first > 1 {
                    return vec![(first + hi[0]) / 2];
                }
                if hi.len() > 1 {
                    return vec![hi[0]];
                }
            }
            // Appending is the common move, so step by one digit rather
            // than halving the gap: keys grow by one digit per 30 or so.
            None if lo.is_empty() => return vec![BASE / 2],
            None if first < BASE - 1 => return vec![first + 1],
            None => {}
        }
        let mut out = vec![first];
        out.extend(midpoint(lo.get(1..).unwrap_or(&[]), None));
        out
    }

    /// `n` ascending keys.
    pub fn spread(n: usize) -> Vec<String> {
        let mut keys: Vec<String> = Vec::with_capacity(n);
        for _ in 0..n {
            let key =
                between(keys.last().map(String::as_str), None).expect("appending always has room");
            keys.push(key);
        }
        keys
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Shape {
        bookmarks: Vec<Plain>,
        folder_colors: BTreeMap<String, String>,
    }

    #[derive(Deserialize, PartialEq, Debug)]
    struct Plain {
        id: String,
        path: String,
    }

    #[derive(Deserialize)]
    struct Case {
        name: String,
        before: Shape,
        ops: Vec<TreeOp>,
        after: Option<Shape>,
        #[serde(default)]
        error: bool,
    }

    fn meta(shape: Shape) -> TreeMeta {
        TreeMeta::from_ordered(
            shape.bookmarks.into_iter().map(|b| (b.id, b.path)),
            shape.folder_colors,
        )
    }

    fn plain(meta: &TreeMeta) -> Vec<(&str, &str)> {
        meta.bookmarks
            .iter()
            .map(|b| (b.id.as_str(), b.path.as_str()))
            .collect()
    }

    /// The cases `lib/tree-meta/ops.test.ts` runs too.
    #[test]
    fn shared_cases() {
        let cases: Vec<Case> =
            serde_json::from_str(include_str!("../tests/tree_meta_ops.json")).unwrap();
        for case in cases {
            let result = apply(&meta(case.before), &case.ops);
            if case.error {
                assert!(result.is_err(), "{}", case.name);
                continue;
            }
            let got = result.unwrap_or_else(|e| panic!("{}: {e}", case.name));
            let want = case.after.expect("a case without an error has an after");
            let want_bookmarks: Vec<_> = want
                .bookmarks
                .iter()
                .map(|b| (b.id.as_str(), b.path.as_str()))
                .collect();
            assert_eq!(plain(&got), want_bookmarks, "{}", case.name);
            assert_eq!(got.folder_colors, want.folder_colors, "{}", case.name);
        }
    }

    #[test]
    fn keys_fall_between() {
        use order::between;
        let first = between(None, None).unwrap();
        let after = between(Some(&first), None).unwrap();
        let before = between(None, Some(&first)).unwrap();
        let mid = between(Some(&before), Some(&first)).unwrap();
        assert!(before < mid && mid < first && first < after);
        for key in [&first, &after, &before, &mid] {
            assert!(!key.ends_with('0'), "{key}");
        }
        let tight = between(Some("a"), Some("a0V")).unwrap();
        assert!("a" < tight.as_str() && tight.as_str() < "a0V");
        let tight = between(Some("az"), Some("b")).unwrap();
        assert!("az" < tight.as_str() && tight.as_str() < "b");
        assert_eq!(between(Some("b"), Some("b")), None, "no room");
        assert_eq!(between(Some("c"), Some("b")), None, "out of order");
        assert_eq!(between(Some("a?"), None), None, "not a key");
        assert_eq!(
            between(Some("a0"), None),
            None,
            "ends in the smallest digit"
        );
    }

    #[test]
    fn keys_stay_ordered_and_short_under_many_inserts() {
        use order::between;
        // Always just after the first key: the worst case for growth.
        let lo = between(None, None).unwrap();
        let mut hi = between(Some(&lo), None).unwrap();
        for _ in 0..1000 {
            let key = between(Some(&lo), Some(&hi)).unwrap();
            assert!(lo < key && key < hi);
            hi = key;
        }
        // About one digit per six halvings.
        assert!(hi.len() < 250, "{}", hi.len());
        let mut prev: Option<String> = None;
        for _ in 0..1000 {
            let key = between(prev.as_deref(), None).unwrap();
            if let Some(p) = &prev {
                assert!(*p < key);
            }
            prev = Some(key);
        }
        assert!(prev.unwrap().len() < 40);
    }

    #[test]
    fn spreads_ascending() {
        let keys = order::spread(50);
        assert_eq!(keys.len(), 50);
        assert!(keys.windows(2).all(|w| w[0] < w[1]));
    }

    #[test]
    fn retargets_on_folder_boundaries() {
        assert_eq!(retarget_path("Notes", "Notes", "N").as_deref(), Some("N"));
        assert_eq!(
            retarget_path("Notes/a.md", "Notes", "N").as_deref(),
            Some("N/a.md")
        );
        assert_eq!(retarget_path("Notes old/a.md", "Notes", "N"), None);
        assert_eq!(retarget_path("Note", "Notes", "N"), None);
    }

    #[test]
    fn moves_between_neighbours_whose_keys_clash() {
        // Two devices moved bookmarks into the same gap: equal keys.
        let mut meta = TreeMeta::from_ordered(
            [("a", "A"), ("b", "B"), ("c", "C"), ("d", "D")]
                .map(|(i, p)| (i.to_string(), p.to_string())),
            BTreeMap::new(),
        );
        meta.bookmarks[2].order = meta.bookmarks[1].order.clone();
        meta.sort();
        let moved = apply(
            &meta,
            &[TreeOp::MoveBookmark {
                id: "d".into(),
                after: Some("b".into()),
            }],
        )
        .unwrap();
        assert_eq!(
            plain(&moved).iter().map(|(i, _)| *i).collect::<Vec<_>>(),
            ["a", "b", "d", "c"]
        );
    }
}
