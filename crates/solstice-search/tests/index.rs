//! `Index`: a folder's docs, refreshed by what changed, cached on disk.

use std::fs;
use std::path::Path;
use std::time::{Duration, SystemTime};

use solstice_search::{Index, Limits, Query};

fn write(root: &Path, rel: &str, text: &str) {
    let path = root.join(rel);
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(path, text).unwrap();
}

fn paths(index: &Index, text: &str) -> Vec<String> {
    let query = Query { text: text.into(), ..Query::default() };
    let mut found: Vec<String> = index.search(&query, Limits::default()).files.into_iter().map(|f| f.path).collect();
    found.sort();
    found
}

#[test]
fn indexes_the_folder_by_relative_path() {
    let dir = tempfile::tempdir().unwrap();
    write(dir.path(), "Top.md", "needle");
    write(dir.path(), "Biology/Cells.md", "a needle here");
    write(dir.path(), "Biology/photo.png", "needle");
    let mut index = Index::open(dir.path().into(), None);
    let stats = index.refresh().unwrap();
    assert_eq!(stats.extracted, 2);
    assert_eq!(paths(&index, "needle"), vec!["Biology/Cells.md", "Top.md"]);
}

#[test]
fn skips_dot_folders_and_excludes() {
    let dir = tempfile::tempdir().unwrap();
    write(dir.path(), "Note.md", "needle");
    write(dir.path(), ".solstice/trash/Old.md", "needle");
    write(dir.path(), ".obsidian/x.md", "needle");
    write(dir.path(), ".hidden.md", "needle");
    write(dir.path(), "Archive/Old.md", "needle");
    write(dir.path(), "Work/Archive/Old.md", "needle");
    write(dir.path(), "Work/Drafts/Draft.md", "needle");
    write(dir.path(), "Drafts/Kept.md", "needle");
    let mut index = Index::open(dir.path().into(), None);
    index.set_excludes(&["Archive".into(), "/Work/Drafts/".into(), "  ".into()]);
    index.refresh().unwrap();
    assert_eq!(paths(&index, "needle"), vec!["Drafts/Kept.md", "Note.md"]);

    // Excluding more after a refresh drops what's now excluded at once.
    index.set_excludes(&["Drafts".into()]);
    assert_eq!(paths(&index, "needle"), vec!["Note.md"]);
    // And including it again finds it on the next refresh.
    index.set_excludes(&[]);
    index.refresh().unwrap();
    assert_eq!(paths(&index, "needle").len(), 5);
}

#[test]
fn reads_again_only_what_changed() {
    let dir = tempfile::tempdir().unwrap();
    write(dir.path(), "A.md", "alpha");
    write(dir.path(), "B.md", "beta");
    let mut index = Index::open(dir.path().into(), None);
    index.refresh().unwrap();

    assert_eq!(index.refresh().unwrap().extracted, 0);

    write(dir.path(), "A.md", "alpha and gamma");
    let stats = index.refresh().unwrap();
    assert_eq!(stats.extracted, 1);
    assert_eq!(paths(&index, "gamma"), vec!["A.md"]);
}

#[test]
fn notices_a_same_size_edit_by_its_time() {
    let dir = tempfile::tempdir().unwrap();
    write(dir.path(), "A.md", "alpha");
    let mut index = Index::open(dir.path().into(), None);
    index.refresh().unwrap();

    write(dir.path(), "A.md", "omega");
    let file = fs::File::options().write(true).open(dir.path().join("A.md")).unwrap();
    file.set_modified(SystemTime::now() + Duration::from_secs(5)).unwrap();
    index.refresh().unwrap();
    assert_eq!(paths(&index, "omega"), vec!["A.md"]);
}

#[test]
fn forgets_deleted_files() {
    let dir = tempfile::tempdir().unwrap();
    write(dir.path(), "A.md", "needle");
    write(dir.path(), "Sub/B.md", "needle");
    let mut index = Index::open(dir.path().into(), None);
    index.refresh().unwrap();
    fs::remove_dir_all(dir.path().join("Sub")).unwrap();
    let stats = index.refresh().unwrap();
    assert_eq!(stats.removed, 1);
    assert_eq!(paths(&index, "needle"), vec!["A.md"]);
}

#[test]
fn a_folder_that_cant_be_read_keeps_what_it_had() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().join("ws");
    write(&root, "A.md", "needle");
    let mut index = Index::open(root.clone(), None);
    index.refresh().unwrap();
    fs::rename(&root, dir.path().join("moved")).unwrap();
    assert!(index.refresh().is_err());
    assert_eq!(paths(&index, "needle"), vec!["A.md"]);
}

#[test]
fn a_cache_starts_a_reopened_index_warm() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().join("ws");
    let cache = dir.path().join("cache/index.json.gz");
    write(&root, "A.md", "needle");
    write(&root, "B.md", "needle");

    let mut index = Index::open(root.clone(), Some(cache.clone()));
    index.refresh().unwrap();
    index.save().unwrap();
    assert!(cache.exists());

    write(&root, "B.md", "needle, edited while closed");
    let mut reopened = Index::open(root.clone(), Some(cache.clone()));
    // Searchable from the cache before any refresh.
    assert_eq!(paths(&reopened, "needle"), vec!["A.md", "B.md"]);
    assert_eq!(reopened.refresh().unwrap().extracted, 1);
    assert_eq!(paths(&reopened, "edited"), vec!["B.md"]);
}

#[test]
fn a_broken_cache_is_ignored() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().join("ws");
    let cache = dir.path().join("index.json.gz");
    write(&root, "A.md", "needle");
    fs::write(&cache, b"not a cache").unwrap();
    let mut index = Index::open(root, Some(cache));
    assert_eq!(index.refresh().unwrap().extracted, 1);
    assert_eq!(paths(&index, "needle"), vec!["A.md"]);
}

/// Timing, not behaviour: `cargo test -p solstice-search --release -- --ignored`.
#[test]
#[ignore]
fn searching_a_large_vault_is_quick() {
    use std::time::Instant;
    let dir = tempfile::tempdir().unwrap();
    let paragraph = "Notes on cells, their membranes and what moves across them. ".repeat(40);
    for n in 0..2000 {
        write(dir.path(), &format!("Folder {}/Note {n}.md", n % 40), &format!("# Note {n}\n\n{paragraph}\nmitochondria {n}\n"));
    }
    let mut index = Index::open(dir.path().into(), Some(dir.path().join(".solstice/search/index.json.gz")));
    let started = Instant::now();
    index.refresh().unwrap();
    let first = started.elapsed();
    index.save().unwrap();

    let started = Instant::now();
    index.refresh().unwrap();
    let query = Query { text: "mitochondria".into(), ..Query::default() };
    let results = index.search(&query, Limits::default());
    let warm = started.elapsed();
    assert_eq!(results.total, 2000);

    let started = Instant::now();
    let mut reopened = Index::open(dir.path().into(), Some(dir.path().join(".solstice/search/index.json.gz")));
    assert_eq!(reopened.refresh().unwrap().extracted, 0);
    let cached = started.elapsed();
    println!("first read {first:?}, refresh + search {warm:?}, reopen from cache {cached:?}");
    assert!(warm.as_millis() < 250, "{warm:?}");
}

/// A big drawing's handwriting was lost past 64 MB: the file wasn't read.
/// Its `<desc>` comes first, so only its head is.
#[test]
fn a_huge_drawings_handwriting_is_found() {
    let dir = tempfile::tempdir().unwrap();
    let mut svg = String::from("<svg><desc>integrate by parts</desc><metadata><solstice:paper>");
    svg.push_str(&"A".repeat(70 << 20));
    svg.push_str("</solstice:paper></metadata></svg>");
    write(dir.path(), "Big.drawing.svg", &svg);
    let mut index = Index::open(dir.path().to_path_buf(), None);
    index.refresh().unwrap();
    assert_eq!(paths(&index, "by parts"), vec!["Big.drawing.svg"]);
}
