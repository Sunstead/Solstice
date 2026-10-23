//! Matching: the find bar's rules, previews and where each hit jumps.

use solstice_search::{extract, search, Doc, Hit, Jump, Kind, Limits, Place, Query, Results, Segment};

fn note(text: &str) -> Doc {
    extract(Kind::Note, text.as_bytes())
}

fn q(text: &str) -> Query {
    Query { text: text.into(), ..Query::default() }
}

fn run(docs: &[(&str, Doc)], query: &Query) -> Results {
    search(docs.iter().map(|(p, d)| (*p, d)), query, Limits::default())
}

fn hits(docs: &[(&str, Doc)], query: &Query) -> Vec<Hit> {
    run(docs, query).files.into_iter().flat_map(|f| f.hits).collect()
}

/// The highlighted part of a hit's preview.
fn marked(hit: &Hit) -> String {
    let units: Vec<u16> = hit.preview.encode_utf16().collect();
    String::from_utf16(&units[hit.range[0] as usize..hit.range[1] as usize]).unwrap()
}

#[test]
fn nothing_for_an_empty_query() {
    let docs = [("a.md", note("anything"))];
    assert_eq!(run(&docs, &q("")), Results::default());
}

#[test]
fn ignores_case_unless_asked() {
    let docs = [("a.md", note("Cell cell CELL"))];
    assert_eq!(hits(&docs, &q("cell")).len(), 3);
    let exact = Query { case_sensitive: true, ..q("cell") };
    assert_eq!(hits(&docs, &exact).len(), 1);
}

#[test]
fn whole_words_only_when_asked() {
    let docs = [("a.md", note("cat concatenate cat_s cat. кот котик"))];
    assert_eq!(hits(&docs, &q("cat")).len(), 4);
    let word = Query { whole_word: true, ..q("cat") };
    let found = hits(&docs, &word);
    assert_eq!(found.len(), 2, "{found:?}");
    let word = Query { whole_word: true, ..q("кот") };
    assert_eq!(hits(&docs, &word).len(), 1);
}

#[test]
fn overlapping_matches_count_as_the_find_bar_counts_them() {
    let docs = [("a.md", note("aaa"))];
    assert_eq!(hits(&docs, &q("aa")).len(), 2);
}

#[test]
fn case_folding_outside_ascii_keeps_offsets() {
    let docs = [("a.md", note("ÉCOLE et école"))];
    let found = hits(&docs, &q("école"));
    assert_eq!(found.len(), 2);
    assert_eq!(marked(&found[0]), "ÉCOLE");
    assert_eq!(marked(&found[1]), "école");
}

#[test]
fn previews_count_utf16_units() {
    let docs = [("a.md", note("🎉 party 🎉 time"))];
    let found = hits(&docs, &q("time"));
    assert_eq!(found[0].preview, "🎉 party 🎉 time");
    assert_eq!(found[0].range, [12, 16]);
    assert_eq!(marked(&found[0]), "time");
}

#[test]
fn previews_are_the_line_cut_down_around_the_hit() {
    let long = format!("{}needle{}\nnext line", "x".repeat(200), "y".repeat(200));
    let docs = [("a.md", note(&long))];
    let hit = &hits(&docs, &q("needle"))[0];
    assert!(hit.preview.starts_with('…') && hit.preview.ends_with('…'), "{}", hit.preview);
    assert!(hit.preview.chars().count() < 100);
    assert_eq!(marked(hit), "needle");
    assert!(!hit.preview.contains("next line"));
}

#[test]
fn lines_and_columns_are_the_files() {
    let docs = [("a.md", note("one\ntwo 🎉 target\n"))];
    let hit = &hits(&docs, &q("target"))[0];
    assert!(matches!(hit.jump, Jump::Line { line: 1, column: 7, .. }), "{:?}", hit.jump);
}

#[test]
fn comments_arent_searched() {
    let docs = [("a.md", note("seen %%hidden word%% seen"))];
    assert_eq!(hits(&docs, &q("hidden")).len(), 0);
    assert_eq!(hits(&docs, &q("seen")).len(), 2);
}

#[test]
fn ordinals_follow_the_rich_editors_find_matches() {
    // The rich editor's find sees comments and inline code, but not front
    // matter, link destinations or code blocks.
    let text = "---\ntag: cell\n---\n%%cell%% [x](cell.md) cell\n```\ncell\n```\nlast cell\n";
    let docs = [("a.md", note(text))];
    let ordinals: Vec<Option<u32>> = hits(&docs, &q("cell"))
        .into_iter()
        .map(|h| match h.jump {
            Jump::Line { ordinal, .. } => ordinal,
            other => panic!("{other:?}"),
        })
        .collect();
    // front matter, link destination, the visible one, code block, last.
    assert_eq!(ordinals, vec![None, None, Some(1), None, Some(2)]);
}

#[test]
fn other_places_jump_to_their_place() {
    let pdf = Doc {
        kind: Kind::Pdf,
        segments: vec![
            Segment { place: Place::Page { page: 0, ink: false }, text: "intro".into(), skip: vec![] },
            Segment { place: Place::Page { page: 3, ink: true }, text: "scribbled intro".into(), skip: vec![] },
        ],
    };
    let canvas = Doc {
        kind: Kind::Canvas,
        segments: vec![Segment { place: Place::Card { id: "c9".into() }, text: "intro card".into(), skip: vec![] }],
    };
    let drawing = Doc {
        kind: Kind::Drawing,
        segments: vec![Segment { place: Place::Handwriting, text: "intro sketch".into(), skip: vec![] }],
    };
    let docs = [("p.pdf", pdf), ("b.canvas", canvas), ("d.drawing.svg", drawing)];
    let results = run(&docs, &q("intro"));
    let jumps = |path: &str| -> Vec<Jump> {
        results.files.iter().find(|f| f.path == path).unwrap().hits.iter().map(|h| h.jump.clone()).collect()
    };
    assert_eq!(jumps("p.pdf"), vec![Jump::Page { page: 0, ink: false }, Jump::Page { page: 3, ink: true }]);
    assert_eq!(jumps("b.canvas"), vec![Jump::Card { id: "c9".into() }]);
    assert_eq!(jumps("d.drawing.svg"), vec![Jump::Handwriting]);
}

#[test]
fn files_with_more_hits_come_first_then_by_path() {
    let docs = [("b.md", note("x")), ("c.md", note("x x x")), ("a.md", note("x"))];
    let results = run(&docs, &q("x"));
    let order: Vec<&str> = results.files.iter().map(|f| f.path.as_str()).collect();
    assert_eq!(order, vec!["c.md", "a.md", "b.md"]);
    assert_eq!(results.total, 5);
    assert_eq!(results.files[0].kind, Kind::Note);
}

#[test]
fn files_without_hits_are_left_out() {
    let docs = [("a.md", note("x")), ("b.md", note("y"))];
    assert_eq!(run(&docs, &q("x")).files.len(), 1);
}

#[test]
fn limits_cap_hits_but_not_counts() {
    let docs = [("a.md", note(&"x ".repeat(10))), ("b.md", note(&"x ".repeat(10)))];
    let limits = Limits { max_hits: 15, per_file: 8 };
    let results = search(docs.iter().map(|(p, d)| (*p, d)), &q("x"), limits);
    assert_eq!(results.total, 20);
    assert_eq!(results.files[0].count, 10);
    assert_eq!(results.files[0].hits.len(), 8);
    assert_eq!(results.files[1].hits.len(), 7);
    assert!(results.truncated);
}
