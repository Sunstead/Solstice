//! A vault's manifest: which files exist, by stable id, at which path. It's
//! a Yjs document like the notes, so renames, deletes and new files merge
//! the same way edits do.
//!
//! One `Y.Map` named `files` with flat keys `<id>/<field>`, so concurrent
//! changes to different fields of one file (a rename here, a new hash there)
//! both survive. Another, `reviews`, holds merges waiting for a human look.
//! `bookmarks` (flat keys `<id>/path`, `<id>/order`, so a rename and a move
//! of one bookmark both land) and `folderColors` (folder path → `#rrggbb`)
//! hold the vault's [`TreeMeta`]; replicas from before them relay them
//! untouched.

use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::sync::Arc;

use yrs::updates::encoder::Encode;
use yrs::{Any, Doc, Map, MapRef, Out, ReadTxn, Snapshot, StateVector, Transact};

use crate::note::{self, apply, doc_at};
use crate::tree_meta::{is_bookmark_id, Bookmark, TreeMeta};
use crate::Error;

pub type FileId = String;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Kind {
    /// Markdown, synced as CRDT text.
    Note,
    /// Anything else, synced whole by content hash, last writer wins.
    Blob,
}

impl Kind {
    /// `.md` files are notes; everything else is a blob.
    pub fn for_path(path: &str) -> Self {
        let lower = path.to_ascii_lowercase();
        if lower.ends_with(".md") {
            Kind::Note
        } else {
            Kind::Blob
        }
    }

    fn as_str(self) -> &'static str {
        match self {
            Kind::Note => "note",
            Kind::Blob => "blob",
        }
    }
}

/// How a file was deleted, so a later edit can bring it back.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Deleted {
    /// The note's state vector when it was deleted.
    Note(Vec<u8>),
    /// The blob's hash when it was deleted.
    Blob(String),
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Entry {
    pub id: FileId,
    pub path: String,
    pub kind: Kind,
    /// SHA-256 (hex) of a blob's content.
    pub hash: Option<String>,
    pub deleted: Option<Deleted>,
}

impl Entry {
    pub fn is_live(&self) -> bool {
        self.deleted.is_none()
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ReviewKind {
    /// Two sides edited the same text offline.
    Overlap,
    /// A note was deleted on one side and edited on another, and came back.
    Restored,
}

/// A merge waiting for a human look. The snapshots rebuild each side's text.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Review {
    pub kind: ReviewKind,
    /// Unix milliseconds.
    pub at: i64,
    /// The device that noticed it.
    pub device: String,
    pub base: Option<Vec<u8>>,
    pub local: Option<Vec<u8>>,
    pub remote: Option<Vec<u8>>,
}

pub struct Manifest {
    doc: Doc,
    files: MapRef,
    reviews: MapRef,
    bookmarks: MapRef,
    folder_colors: MapRef,
    pub epoch: u32,
}

fn key(id: &str, field: &str) -> String {
    format!("{id}/{field}")
}

fn string(out: Option<Out>) -> Option<String> {
    match out {
        Some(Out::Any(Any::String(s))) => Some(s.to_string()),
        _ => None,
    }
}

fn buffer(any: Option<&Any>) -> Option<Vec<u8>> {
    match any {
        Some(Any::Buffer(b)) => Some(b.to_vec()),
        _ => None,
    }
}

impl Manifest {
    pub fn new(epoch: u32) -> Self {
        Self::with_doc(note::new_doc(None), epoch)
    }

    pub fn load(state: &[u8], epoch: u32) -> Result<Self, Error> {
        let manifest = Self::new(epoch);
        apply(&manifest.doc, state)?;
        Ok(manifest)
    }

    fn with_doc(doc: Doc, epoch: u32) -> Self {
        let files = doc.get_or_insert_map("files");
        let reviews = doc.get_or_insert_map("reviews");
        let bookmarks = doc.get_or_insert_map("bookmarks");
        let folder_colors = doc.get_or_insert_map("folderColors");
        Self {
            doc,
            files,
            reviews,
            bookmarks,
            folder_colors,
            epoch,
        }
    }

    pub fn snapshot(&self) -> Snapshot {
        self.doc.transact().snapshot()
    }

    /// The manifest as it was at `snapshot`, read-only by convention.
    pub fn at(&self, snapshot: &Snapshot) -> Result<Manifest, Error> {
        Ok(Self::with_doc(doc_at(&self.doc, snapshot)?, self.epoch))
    }

    pub fn state_vector(&self) -> Vec<u8> {
        self.doc.transact().state_vector().encode_v1()
    }

    pub fn encode_state(&self) -> Vec<u8> {
        self.doc
            .transact()
            .encode_state_as_update_v1(&StateVector::default())
    }

    pub fn encode_diff(&self, state_vector: &[u8]) -> Result<Vec<u8>, Error> {
        let sv = note::decode_state_vector(state_vector)?;
        Ok(self.doc.transact().encode_diff_v1(&sv))
    }

    pub fn apply_update(&self, update: &[u8]) -> Result<(), Error> {
        apply(&self.doc, update)
    }

    /// Every file ever recorded, deleted ones included. Entries whose path
    /// isn't a plain, visible vault path are left out: any peer can write
    /// the manifest, and its paths become files on every other one.
    pub fn entries(&self) -> BTreeMap<FileId, Entry> {
        let txn = self.doc.transact();
        let ids: BTreeSet<String> = self
            .files
            .keys(&txn)
            .filter_map(|k| k.strip_suffix("/path").map(str::to_string))
            .collect();
        ids.into_iter()
            .filter_map(|id| {
                let path =
                    string(self.files.get(&txn, &key(&id, "path"))).filter(|p| is_safe_path(p))?;
                let kind = match string(self.files.get(&txn, &key(&id, "kind"))).as_deref() {
                    Some("blob") => Kind::Blob,
                    _ => Kind::Note,
                };
                let hash = string(self.files.get(&txn, &key(&id, "hash")));
                let deleted = match self.files.get(&txn, &key(&id, "deleted")) {
                    Some(Out::Any(Any::Buffer(sv))) => Some(Deleted::Note(sv.to_vec())),
                    Some(Out::Any(Any::String(h))) => Some(Deleted::Blob(h.to_string())),
                    _ => None,
                };
                Some((
                    id.clone(),
                    Entry {
                        id,
                        path,
                        kind,
                        hash,
                        deleted,
                    },
                ))
            })
            .collect()
    }

    pub fn entry(&self, id: &str) -> Option<Entry> {
        self.entries().remove(id)
    }

    /// Records a new file and returns its id and the update to send.
    pub fn create(&self, path: &str, hash: Option<&str>) -> (FileId, Vec<u8>) {
        let id = uuid::Uuid::new_v4().to_string();
        let kind = Kind::for_path(path);
        let mut txn = self.doc.transact_mut();
        self.files.insert(&mut txn, key(&id, "kind"), kind.as_str());
        if let Some(hash) = hash {
            self.files.insert(&mut txn, key(&id, "hash"), hash);
        }
        // Last, so `entries()` never sees a half-written file.
        self.files.insert(&mut txn, key(&id, "path"), path);
        (id, txn.encode_update_v1())
    }

    pub fn set_path(&self, id: &str, path: &str) -> Vec<u8> {
        let mut txn = self.doc.transact_mut();
        self.files.insert(&mut txn, key(id, "path"), path);
        txn.encode_update_v1()
    }

    pub fn set_hash(&self, id: &str, hash: &str) -> Vec<u8> {
        let mut txn = self.doc.transact_mut();
        self.files.insert(&mut txn, key(id, "hash"), hash);
        txn.encode_update_v1()
    }

    /// Marks a file deleted. It stays in the manifest as a tombstone, so a
    /// concurrent edit can bring it back.
    pub fn delete(&self, id: &str, how: Deleted) -> Vec<u8> {
        let value = match how {
            Deleted::Note(sv) => Any::Buffer(sv.into()),
            Deleted::Blob(hash) => Any::String(hash.into()),
        };
        let mut txn = self.doc.transact_mut();
        self.files.insert(&mut txn, key(id, "deleted"), value);
        txn.encode_update_v1()
    }

    pub fn restore(&self, id: &str) -> Vec<u8> {
        let mut txn = self.doc.transact_mut();
        self.files.remove(&mut txn, &key(id, "deleted"));
        txn.encode_update_v1()
    }

    pub fn reviews(&self) -> BTreeMap<FileId, Review> {
        let txn = self.doc.transact();
        self.reviews
            .iter(&txn)
            .filter_map(|(id, value)| {
                let Out::Any(Any::Map(map)) = value else {
                    return None;
                };
                let kind = match map.get("kind") {
                    Some(Any::String(k)) if &**k == "restored" => ReviewKind::Restored,
                    _ => ReviewKind::Overlap,
                };
                let at = match map.get("at") {
                    Some(Any::Number(n)) => n.as_i64().unwrap_or_default(),
                    _ => 0,
                };
                let device = match map.get("device") {
                    Some(Any::String(d)) => d.to_string(),
                    _ => String::new(),
                };
                Some((
                    id.to_string(),
                    Review {
                        kind,
                        at,
                        device,
                        base: buffer(map.get("base")),
                        local: buffer(map.get("local")),
                        remote: buffer(map.get("remote")),
                    },
                ))
            })
            .collect()
    }

    pub fn set_review(&self, id: &str, review: &Review) -> Vec<u8> {
        let mut map: HashMap<String, Any> = HashMap::new();
        let kind = match review.kind {
            ReviewKind::Overlap => "overlap",
            ReviewKind::Restored => "restored",
        };
        map.insert("kind".into(), Any::String(kind.into()));
        map.insert("at".into(), Any::Number(review.at.into()));
        map.insert("device".into(), Any::String(review.device.as_str().into()));
        for (name, value) in [
            ("base", &review.base),
            ("local", &review.local),
            ("remote", &review.remote),
        ] {
            if let Some(bytes) = value {
                map.insert(name.into(), Any::Buffer(bytes.as_slice().into()));
            }
        }
        let mut txn = self.doc.transact_mut();
        self.reviews.insert(&mut txn, id, Any::Map(Arc::new(map)));
        txn.encode_update_v1()
    }

    pub fn resolve_review(&self, id: &str) -> Vec<u8> {
        let mut txn = self.doc.transact_mut();
        self.reviews.remove(&mut txn, id);
        txn.encode_update_v1()
    }

    /// The bookmarks and folder colors, leaving out any a peer wrote with
    /// a path that isn't a plain, visible vault path or a color that isn't
    /// `#rrggbb`.
    pub fn tree_meta(&self) -> TreeMeta {
        let txn = self.doc.transact();
        let ids: BTreeSet<String> = self
            .bookmarks
            .keys(&txn)
            .filter_map(|k| k.strip_suffix("/path"))
            .filter(|id| is_bookmark_id(id))
            .map(str::to_string)
            .collect();
        let bookmarks = ids
            .into_iter()
            .filter_map(|id| {
                let path = string(self.bookmarks.get(&txn, &key(&id, "path")))
                    .filter(|p| is_safe_path(p))?;
                let order =
                    string(self.bookmarks.get(&txn, &key(&id, "order"))).unwrap_or_default();
                Some(Bookmark { id, path, order })
            })
            .collect();
        let folder_colors = self
            .folder_colors
            .iter(&txn)
            .filter_map(|(path, value)| {
                let Out::Any(Any::String(color)) = value else {
                    return None;
                };
                let ok = is_safe_path(path)
                    && solstice_core::normalize_hex(&color).as_deref() == Some(&*color);
                ok.then(|| (path.to_string(), color.to_string()))
            })
            .collect();
        let mut meta = TreeMeta {
            bookmarks,
            folder_colors,
        };
        meta.sort();
        meta
    }

    /// Makes the tree meta `target`, writing only the keys that differ, so
    /// another device's change to anything else survives the merge. `None`
    /// when it already is.
    pub fn write_tree_meta(&self, target: &TreeMeta) -> Option<Vec<u8>> {
        let current = self.tree_meta();
        if current == *target {
            return None;
        }
        let before: HashMap<&str, &Bookmark> = current
            .bookmarks
            .iter()
            .map(|b| (b.id.as_str(), b))
            .collect();
        let kept: BTreeSet<&str> = target.bookmarks.iter().map(|b| b.id.as_str()).collect();
        let mut txn = self.doc.transact_mut();
        for id in before.keys().filter(|id| !kept.contains(*id)) {
            self.bookmarks.remove(&mut txn, &key(id, "path"));
            self.bookmarks.remove(&mut txn, &key(id, "order"));
        }
        for bookmark in &target.bookmarks {
            let old = before.get(bookmark.id.as_str());
            if old.is_none_or(|o| o.order != bookmark.order) {
                self.bookmarks.insert(
                    &mut txn,
                    key(&bookmark.id, "order"),
                    bookmark.order.as_str(),
                );
            }
            // Path last, as in `create`.
            if old.is_none_or(|o| o.path != bookmark.path) {
                self.bookmarks
                    .insert(&mut txn, key(&bookmark.id, "path"), bookmark.path.as_str());
            }
        }
        for path in current.folder_colors.keys() {
            if !target.folder_colors.contains_key(path) {
                self.folder_colors.remove(&mut txn, path);
            }
        }
        for (path, color) in &target.folder_colors {
            if current.folder_colors.get(path) != Some(color) {
                self.folder_colors
                    .insert(&mut txn, path.as_str(), color.as_str());
            }
        }
        Some(txn.encode_update_v1())
    }

    /// Where each live file goes on disk: its path, unless another live file
    /// claims the same path (ignoring case, for Windows and macOS), in which
    /// case all but the lowest id get ` 1`, ` 2`... before the extension.
    /// Every replica computes the same answer.
    pub fn materialize(&self) -> BTreeMap<String, FileId> {
        let live: Vec<Entry> = self
            .entries()
            .into_values()
            .filter(Entry::is_live)
            .collect();
        let mut taken: BTreeSet<String> = live.iter().map(|e| e.path.to_lowercase()).collect();
        let mut by_path: BTreeMap<String, Vec<&Entry>> = BTreeMap::new();
        for entry in &live {
            by_path
                .entry(entry.path.to_lowercase())
                .or_default()
                .push(entry);
        }
        let mut out = BTreeMap::new();
        for group in by_path.values_mut() {
            group.sort_by(|a, b| a.id.cmp(&b.id));
            let (first, rest) = group.split_first().expect("groups are never empty");
            out.insert(first.path.clone(), first.id.clone());
            for entry in rest {
                let mut n = 1;
                let path = loop {
                    let candidate = numbered(&entry.path, n);
                    if taken.insert(candidate.to_lowercase()) {
                        break candidate;
                    }
                    n += 1;
                };
                out.insert(path, entry.id.clone());
            }
        }
        out
    }
}

/// A path as [`VaultPath`] writes it (relative, `/`-separated, no `.` or
/// `..`, nothing empty) and not hidden, so it stays inside the vault folder
/// and out of `.solstice/`.
///
/// [`VaultPath`]: solstice_core::VaultPath
fn is_safe_path(path: &str) -> bool {
    solstice_core::VaultPath::parse(path).is_ok_and(|p| p.as_str() == path && !p.is_hidden())
}

/// `notes/Untitled.md` → `notes/Untitled 1.md`, the same rule as the
/// desktop app's `save_attachment`.
pub fn numbered(path: &str, n: u32) -> String {
    let name_start = path.rfind('/').map_or(0, |i| i + 1);
    match path[name_start..].rfind('.') {
        Some(dot) if dot > 0 => {
            let at = name_start + dot;
            format!("{} {n}{}", &path[..at], &path[at..])
        }
        _ => format!("{path} {n}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tree_meta::{self, TreeOp};

    fn sync(a: &Manifest, b: &Manifest) {
        let to_b = a.encode_diff(&b.state_vector()).unwrap();
        let to_a = b.encode_diff(&a.state_vector()).unwrap();
        b.apply_update(&to_b).unwrap();
        a.apply_update(&to_a).unwrap();
    }

    #[test]
    fn records_files() {
        let m = Manifest::new(0);
        let (note, _) = m.create("notes/todo.md", None);
        let (img, _) = m.create("img/a.png", Some("abc"));
        let entries = m.entries();
        assert_eq!(entries[&note].kind, Kind::Note);
        assert_eq!(entries[&img].kind, Kind::Blob);
        assert_eq!(entries[&img].hash.as_deref(), Some("abc"));
        m.set_path(&note, "todo.md");
        m.delete(&img, Deleted::Blob("abc".into()));
        let paths: Vec<_> = m.materialize().into_keys().collect();
        assert_eq!(paths, ["todo.md"]);
        m.restore(&img);
        assert_eq!(m.materialize().len(), 2);
    }

    #[test]
    fn ignores_paths_that_leave_the_vault() {
        let m = Manifest::new(0);
        let (ok, _) = m.create("notes/fine.md", None);
        {
            // What a hostile peer could write straight into the Y.Map.
            let mut txn = m.doc.transact_mut();
            for (i, bad) in [
                "../escape.md",
                "notes/../../escape.md",
                "/etc/passwd",
                "C:/Windows/evil.md",
                ".solstice/state.db",
                "notes/.git/config",
                "notes//double.md",
                "notes\\back.md",
                "",
            ]
            .into_iter()
            .enumerate()
            {
                m.files
                    .insert(&mut txn, key(&format!("bad{i}"), "path"), bad);
            }
        }
        let entries = m.entries();
        assert_eq!(entries.keys().collect::<Vec<_>>(), [&ok]);
        assert_eq!(
            m.materialize().into_keys().collect::<Vec<_>>(),
            ["notes/fine.md"]
        );
    }

    #[test]
    fn keeps_concurrent_changes_to_different_fields() {
        let a = Manifest::new(0);
        let (id, _) = a.create("pic.png", Some("one"));
        let b = Manifest::load(&a.encode_state(), 0).unwrap();
        a.set_path(&id, "renamed.png");
        b.set_hash(&id, "two");
        sync(&a, &b);
        let e = a.entry(&id).unwrap();
        assert_eq!(
            (e.path.as_str(), e.hash.as_deref()),
            ("renamed.png", Some("two"))
        );
        assert_eq!(b.entry(&id), Some(e));
    }

    #[test]
    fn numbers_clashing_paths_the_same_everywhere() {
        let a = Manifest::new(0);
        let b = Manifest::load(&a.encode_state(), 0).unwrap();
        let (x, _) = a.create("Untitled.md", None);
        let (y, _) = b.create("untitled.md", None);
        a.create("Untitled 1.md", None);
        sync(&a, &b);
        let placed = a.materialize();
        assert_eq!(placed, b.materialize());
        let (low, high) = if x < y { (x, y) } else { (y, x) };
        let path_of = |id: &str| {
            placed
                .iter()
                .find(|(_, v)| v.as_str() == id)
                .unwrap()
                .0
                .clone()
        };
        assert_eq!(path_of(&low).to_lowercase(), "untitled.md");
        assert_eq!(path_of(&high).to_lowercase(), "untitled 2.md");
    }

    #[test]
    fn numbers_names() {
        assert_eq!(numbered("notes/Untitled.md", 1), "notes/Untitled 1.md");
        assert_eq!(numbered("v1.2/README", 3), "v1.2/README 3");
        assert_eq!(numbered(".hidden", 1), ".hidden 1");
    }

    #[test]
    fn stores_reviews() {
        let m = Manifest::new(0);
        let review = Review {
            kind: ReviewKind::Overlap,
            at: 1_790_000_000_000,
            device: "laptop".into(),
            base: Some(vec![1, 2]),
            local: Some(vec![3]),
            remote: None,
        };
        m.set_review("note-1", &review);
        assert_eq!(m.reviews()["note-1"], review);
        m.resolve_review("note-1");
        assert!(m.reviews().is_empty());
    }

    fn tree(pairs: &[(&str, &str)]) -> TreeMeta {
        TreeMeta::from_ordered(
            pairs.iter().map(|(i, p)| (i.to_string(), p.to_string())),
            BTreeMap::new(),
        )
    }

    fn ids(m: &Manifest) -> Vec<String> {
        m.tree_meta().bookmarks.into_iter().map(|b| b.id).collect()
    }

    #[test]
    fn stores_bookmarks_and_folder_colors() {
        let m = Manifest::new(0);
        let mut meta = tree(&[("a", "Plan.md"), ("b", "Projects")]);
        meta.folder_colors
            .insert("Projects".into(), "#e5484d".into());
        assert!(m.write_tree_meta(&meta).is_some());
        assert_eq!(m.tree_meta(), meta);
        assert!(m.write_tree_meta(&meta).is_none(), "nothing changed");
        let copy = Manifest::load(&m.encode_state(), 0).unwrap();
        assert_eq!(copy.tree_meta(), meta);
        assert!(m.write_tree_meta(&TreeMeta::default()).is_some());
        assert_eq!(m.tree_meta(), TreeMeta::default());
    }

    #[test]
    fn ignores_unsafe_tree_meta() {
        let m = Manifest::new(0);
        m.write_tree_meta(&tree(&[("ok", "fine.md")]));
        {
            let mut txn = m.doc.transact_mut();
            for (i, bad) in ["../x", ".solstice/x", "a/.git/b", ""]
                .into_iter()
                .enumerate()
            {
                m.bookmarks
                    .insert(&mut txn, key(&format!("bad{i}"), "path"), bad);
                m.folder_colors.insert(&mut txn, bad, "#ffffff");
            }
            m.bookmarks.insert(&mut txn, "a/b/path", "fine.md");
            m.folder_colors.insert(&mut txn, "Folder", "red");
            m.folder_colors.insert(&mut txn, "Upper", "#FFFFFF");
        }
        let meta = m.tree_meta();
        assert_eq!(ids(&m), ["ok"]);
        assert!(meta.folder_colors.is_empty(), "{:?}", meta.folder_colors);
    }

    #[test]
    fn concurrent_reorder_and_rename_of_one_bookmark_both_land() {
        let a = Manifest::new(0);
        a.write_tree_meta(&tree(&[("x", "X.md"), ("y", "Y.md"), ("z", "Z.md")]));
        let b = Manifest::load(&a.encode_state(), 0).unwrap();
        let moved = tree_meta::apply(
            &a.tree_meta(),
            &[TreeOp::MoveBookmark {
                id: "x".into(),
                after: Some("z".into()),
            }],
        )
        .unwrap();
        a.write_tree_meta(&moved);
        let renamed = tree_meta::apply(
            &b.tree_meta(),
            &[TreeOp::Retarget {
                from: "X.md".into(),
                to: "Renamed.md".into(),
            }],
        )
        .unwrap();
        b.write_tree_meta(&renamed);
        sync(&a, &b);
        assert_eq!(a.tree_meta(), b.tree_meta());
        assert_eq!(ids(&a), ["y", "z", "x"]);
        assert_eq!(a.tree_meta().bookmarks[2].path, "Renamed.md");
    }

    #[test]
    fn concurrent_moves_into_one_gap_order_alike() {
        let a = Manifest::new(0);
        a.write_tree_meta(&tree(&[("p", "P"), ("q", "Q"), ("r", "R"), ("s", "S")]));
        let b = Manifest::load(&a.encode_state(), 0).unwrap();
        let after_p = |id: &str| TreeOp::MoveBookmark {
            id: id.into(),
            after: Some("p".into()),
        };
        a.write_tree_meta(&tree_meta::apply(&a.tree_meta(), &[after_p("r")]).unwrap());
        b.write_tree_meta(&tree_meta::apply(&b.tree_meta(), &[after_p("s")]).unwrap());
        sync(&a, &b);
        assert_eq!(ids(&a), ids(&b));
        assert_eq!(&ids(&a)[..1], ["p"]);
        assert_eq!(ids(&a).last().map(String::as_str), Some("q"));
    }

    #[test]
    fn writes_only_what_changed() {
        let a = Manifest::new(0);
        a.write_tree_meta(&tree(&[("x", "X"), ("y", "Y")]));
        let b = Manifest::load(&a.encode_state(), 0).unwrap();
        // A moves x; B renames y. A's write must not put y's old path back.
        let moved = tree_meta::apply(
            &a.tree_meta(),
            &[TreeOp::MoveBookmark {
                id: "x".into(),
                after: Some("y".into()),
            }],
        )
        .unwrap();
        a.write_tree_meta(&moved);
        b.write_tree_meta(
            &tree_meta::apply(
                &b.tree_meta(),
                &[TreeOp::Retarget {
                    from: "Y".into(),
                    to: "Y2".into(),
                }],
            )
            .unwrap(),
        );
        sync(&a, &b);
        let paths: Vec<_> = a
            .tree_meta()
            .bookmarks
            .into_iter()
            .map(|b| b.path)
            .collect();
        assert_eq!(paths, ["Y2", "X"]);
    }

    #[test]
    fn relays_maps_it_does_not_know() {
        // A manifest from before bookmarks: only `files` and `reviews`.
        let old = Doc::new();
        old.get_or_insert_map("files");
        old.get_or_insert_map("reviews");
        let new = Manifest::new(0);
        let mut meta = tree(&[("a", "A.md")]);
        meta.folder_colors.insert("F".into(), "#123456".into());
        new.write_tree_meta(&meta);
        apply(&old, &new.encode_state()).unwrap();
        let relayed = old
            .transact()
            .encode_state_as_update_v1(&StateVector::default());
        let third = Manifest::load(&relayed, 0).unwrap();
        assert_eq!(third.tree_meta(), meta);
    }
}
