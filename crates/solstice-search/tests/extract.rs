//! What `extract` reads from each kind of file.

use lopdf::{dictionary, Document, Object, Stream};
use solstice_search::extract::comment_ranges;
use solstice_search::{extract, kind_of, Doc, Kind, Place};

fn texts(doc: &Doc) -> Vec<(&Place, &str)> {
    doc.segments.iter().map(|s| (&s.place, s.text.as_str())).collect()
}

#[test]
fn kinds_by_name() {
    assert_eq!(kind_of("Note.md"), Some(Kind::Note));
    assert_eq!(kind_of("Groceries.task.md"), Some(Kind::Note));
    assert_eq!(kind_of("README.MD"), Some(Kind::Note));
    assert_eq!(kind_of("Board.canvas"), Some(Kind::Canvas));
    assert_eq!(kind_of("Sketch.drawing.svg"), Some(Kind::Drawing));
    assert_eq!(kind_of("Paper.pdf"), Some(Kind::Pdf));
    assert_eq!(kind_of("logo.svg"), None);
    assert_eq!(kind_of("photo.png"), None);
}

/// The same cases as `lib/comment/comment.test.ts`, from one file.
#[test]
fn comment_ranges_agree_with_strip_comments() {
    #[derive(serde::Deserialize)]
    struct Case {
        input: String,
        stripped: String,
    }
    let cases: Vec<Case> = serde_json::from_str(include_str!("comments.json")).unwrap();
    for case in cases {
        let mut out = String::new();
        let mut at = 0;
        for [start, end] in comment_ranges(&case.input) {
            out.push_str(&case.input[at..start]);
            at = end;
        }
        out.push_str(&case.input[at..]);
        assert_eq!(out, case.stripped, "for {:?}", case.input);
    }
}

#[test]
fn a_note_is_its_raw_text_with_comments_skipped() {
    let note = "---\ntags: [biology]\n---\nSee [[Cells|the cell]] and [docs](https://example.com).\nKeep %%secret%% this.\n";
    let doc = extract(Kind::Note, note.as_bytes());
    assert_eq!(doc.kind, Kind::Note);
    assert_eq!(texts(&doc), vec![(&Place::Text, note)]);
    let [start, end] = doc.segments[0].skip[0];
    assert_eq!(&note[start..end], "%%secret%%");
}

#[test]
fn a_canvas_is_its_text_cards() {
    let canvas = r#"{
      "nodes": [
        { "id": "a1", "type": "text", "text": "Photosynthesis", "x": 0, "y": 0, "width": 10, "height": 10 },
        { "id": "f1", "type": "file", "file": "Note.md", "x": 0, "y": 0, "width": 10, "height": 10 },
        { "id": "g1", "type": "group", "label": "Plants", "x": 0, "y": 0, "width": 10, "height": 10 }
      ],
      "edges": []
    }"#;
    let doc = extract(Kind::Canvas, canvas.as_bytes());
    assert_eq!(
        texts(&doc),
        vec![
            (&Place::Card { id: "a1".into() }, "Photosynthesis"),
            (&Place::Card { id: "g1".into() }, "Plants"),
        ]
    );
}

#[test]
fn a_canvas_that_isnt_json_has_nothing() {
    assert!(extract(Kind::Canvas, b"{ nope").segments.is_empty());
}

#[test]
fn a_drawing_is_its_handwriting() {
    let svg = r#"<svg xmlns="http://www.w3.org/2000/svg"><metadata><solstice:paper version="1">AAAA</solstice:paper></metadata>
  <desc>Buy milk &amp; eggs &lt;soon&gt;</desc>
  <rect/></svg>"#;
    let doc = extract(Kind::Drawing, svg.as_bytes());
    assert_eq!(texts(&doc), vec![(&Place::Handwriting, "Buy milk & eggs <soon>")]);
}

#[test]
fn a_drawing_without_handwriting_has_nothing() {
    let doc = extract(Kind::Drawing, b"<svg><desc></desc></svg>");
    assert!(doc.segments.is_empty());
}

fn pdf(pages: &[&str]) -> Vec<u8> {
    let mut doc = Document::with_version("1.7");
    let pages_id = doc.new_object_id();
    let font = doc.add_object(dictionary! {
        "Type" => "Font", "Subtype" => "Type1", "BaseFont" => "Helvetica", "Encoding" => "WinAnsiEncoding",
    });
    let mut kids = Vec::new();
    for text in pages {
        let content = doc.add_object(Stream::new(
            dictionary! {},
            format!("BT /F1 12 Tf 72 720 Td ({text}) Tj ET").into_bytes(),
        ));
        kids.push(Object::Reference(doc.add_object(dictionary! {
            "Type" => "Page",
            "Parent" => pages_id,
            "MediaBox" => vec![0.into(), 0.into(), 612.into(), 792.into()],
            "Contents" => content,
            "Resources" => dictionary! { "Font" => dictionary! { "F1" => font } },
        })));
    }
    doc.objects.insert(
        pages_id,
        Object::Dictionary(dictionary! { "Type" => "Pages", "Count" => pages.len() as i64, "Kids" => kids }),
    );
    let catalog = doc.add_object(dictionary! { "Type" => "Catalog", "Pages" => pages_id });
    doc.trailer.set("Root", catalog);
    let mut out = Vec::new();
    doc.save_to(&mut out).unwrap();
    out
}

#[test]
fn a_pdf_is_its_pages_and_their_handwriting() {
    let marked = solstice_pdf::apply(
        &pdf(&["Mitochondria", "Ribosome"]),
        &[],
        &[solstice_pdf::Edit {
            page: 1,
            markup: Some(solstice_pdf::Markup {
                data: b"%PPK".to_vec(),
                text: "handwriting on page 2".into(),
                art: None,
                links: Vec::new(),
            }),
            absorbed: Vec::new(),
        }],
    )
    .unwrap();
    let doc = extract(Kind::Pdf, &marked);
    let found = texts(&doc);
    assert!(found.iter().any(|(p, t)| **p == Place::Page { page: 0, ink: false } && t.contains("Mitochondria")));
    assert!(found.iter().any(|(p, t)| **p == Place::Page { page: 1, ink: false } && t.contains("Ribosome")));
    assert!(found.contains(&(&Place::Page { page: 1, ink: true }, "handwriting on page 2")));
    assert!(!found.iter().any(|(p, _)| **p == Place::Page { page: 0, ink: true }));
}

#[test]
fn a_pdf_that_cant_be_read_has_nothing() {
    assert!(extract(Kind::Pdf, b"%PDF-1.7 garbage").segments.is_empty());
}
