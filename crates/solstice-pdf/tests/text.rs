//! `page_texts`: what search reads from a PDF.

use lopdf::{dictionary, Document, Object, Stream};
use solstice_pdf::{apply, page_texts, Edit, Markup};

/// A PDF of one page per string, each page's text set in Helvetica.
fn with_text(pages: &[&str]) -> Vec<u8> {
    let mut doc = Document::with_version("1.7");
    let pages_id = doc.new_object_id();
    let font = doc.add_object(dictionary! {
        "Type" => "Font",
        "Subtype" => "Type1",
        "BaseFont" => "Helvetica",
        "Encoding" => "WinAnsiEncoding",
    });
    let mut kids = Vec::new();
    for text in pages {
        let content = doc.add_object(Stream::new(
            dictionary! {},
            format!("BT /F1 12 Tf 72 720 Td ({text}) Tj ET").into_bytes(),
        ));
        let page = doc.add_object(dictionary! {
            "Type" => "Page",
            "Parent" => pages_id,
            "MediaBox" => vec![0.into(), 0.into(), 612.into(), 792.into()],
            "Contents" => content,
            "Resources" => dictionary! { "Font" => dictionary! { "F1" => font } },
        });
        kids.push(Object::Reference(page));
    }
    doc.objects.insert(
        pages_id,
        Object::Dictionary(dictionary! {
            "Type" => "Pages",
            "Count" => pages.len() as i64,
            "Kids" => kids,
        }),
    );
    let catalog = doc.add_object(dictionary! { "Type" => "Catalog", "Pages" => pages_id });
    doc.trailer.set("Root", catalog);
    let mut out = Vec::new();
    doc.save_to(&mut out).unwrap();
    out
}

fn marks(page: usize, text: &str) -> Edit {
    Edit {
        page,
        markup: Some(Markup {
            data: b"%PPK markup".to_vec(),
            text: text.into(),
            art: None,
            links: Vec::new(),
        }),
        absorbed: Vec::new(),
    }
}

#[test]
fn reads_each_pages_text() {
    let texts = page_texts(&with_text(&["Mitochondria", "Ribosome"])).unwrap();
    assert_eq!(texts.len(), 2);
    assert!(texts[0].text.contains("Mitochondria"), "{:?}", texts[0]);
    assert!(texts[1].text.contains("Ribosome"), "{:?}", texts[1]);
    assert!(texts.iter().all(|t| t.handwriting.is_empty()));
}

#[test]
fn reads_handwriting_from_our_marks_by_page() {
    let pdf = apply(&with_text(&["One", "Two", "Three"]), &[], &[marks(1, "handwriting on page 2")]).unwrap();
    let texts = page_texts(&pdf).unwrap();
    assert_eq!(texts[0].handwriting, "");
    assert_eq!(texts[1].handwriting, "handwriting on page 2");
    assert_eq!(texts[2].handwriting, "");
}

#[test]
fn reads_handwriting_outside_ascii() {
    let pdf = apply(&with_text(&["One"]), &[], &[marks(0, "café ✓")]).unwrap();
    assert_eq!(page_texts(&pdf).unwrap()[0].handwriting, "café ✓");
}

#[test]
fn refuses_what_isnt_a_pdf() {
    assert!(page_texts(b"not a pdf").is_err());
}
