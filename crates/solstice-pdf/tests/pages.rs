//! Arranging a PDF's pages: a save's final page order, which reorders and
//! drops pages (the iPad's page sheet), after any pages it adds and before
//! its edits.

use lopdf::{dictionary, Document, Object, ObjectId, Stream};
use solstice_pdf::{apply_arranged, read, Edit, Insert, Markup};

/// A PDF whose pages say `labels`, one each, under a page tree `nested`
/// one level deep (with the media box inherited from it) or flat.
fn labelled(labels: &[&str], nested: bool) -> Document {
    let mut doc = Document::with_version("1.7");
    let root = doc.new_object_id();
    let parent = if nested { doc.new_object_id() } else { root };
    let mut kids = Vec::new();
    for label in labels {
        let content = doc.add_object(Stream::new(
            dictionary! {},
            format!("BT /F1 12 Tf 72 720 Td ({label}) Tj ET").into_bytes(),
        ));
        let mut page = dictionary! { "Type" => "Page", "Parent" => parent, "Contents" => content };
        if !nested {
            page.set("MediaBox", vec![0.into(), 0.into(), 612.into(), 792.into()]);
        }
        kids.push(Object::Reference(doc.add_object(page)));
    }
    if nested {
        doc.objects.insert(
            parent,
            Object::Dictionary(dictionary! {
                "Type" => "Pages",
                "Parent" => root,
                "Count" => labels.len() as i64,
                "Kids" => kids,
                "MediaBox" => vec![0.into(), 0.into(), 300.into(), 400.into()],
            }),
        );
        kids = vec![Object::Reference(parent)];
    }
    doc.objects.insert(
        root,
        Object::Dictionary(dictionary! { "Type" => "Pages", "Count" => labels.len() as i64, "Kids" => kids }),
    );
    let catalog = doc.add_object(dictionary! { "Type" => "Catalog", "Pages" => root });
    doc.trailer.set("Root", catalog);
    doc
}

fn bytes(doc: &mut Document) -> Vec<u8> {
    let mut out = Vec::new();
    doc.save_to(&mut out).unwrap();
    out
}

fn load(pdf: &[u8]) -> Document {
    Document::load_mem(pdf).unwrap()
}

fn pages(doc: &Document) -> Vec<ObjectId> {
    doc.get_pages().into_values().collect()
}

/// What each page says, in order.
fn labels(pdf: &[u8]) -> Vec<String> {
    let doc = load(pdf);
    pages(&doc)
        .into_iter()
        .map(|page| {
            let content = doc.get_page_content(page);
            let text = String::from_utf8_lossy(&content);
            let start = text.find('(').unwrap() + 1;
            let end = text.find(')').unwrap();
            text[start..end].to_string()
        })
        .collect()
}

fn markup() -> Markup {
    Markup {
        data: b"%PPK-moved".to_vec(),
        text: String::new(),
        art: None,
        links: Vec::new(),
    }
}

#[test]
fn pages_go_in_the_order_given() {
    let pdf = bytes(&mut labelled(&["a", "b", "c"], false));
    let out = apply_arranged(&pdf, &[], Some(&[2, 0, 1]), &[]).unwrap();
    assert_eq!(labels(&out), ["c", "a", "b"]);
}

#[test]
fn pages_left_out_are_deleted_and_their_objects_go() {
    let pdf = bytes(&mut labelled(&["a", "b", "c"], false));
    let out = apply_arranged(&pdf, &[], Some(&[0, 2]), &[]).unwrap();
    assert_eq!(labels(&out), ["a", "c"]);
    let after = load(&out);
    // The deleted page's content stream isn't carried along.
    let left: Vec<String> = after
        .objects
        .values()
        .filter_map(|o| o.as_stream().ok())
        .map(|s| String::from_utf8_lossy(&s.decompressed_content().unwrap_or_else(|_| s.content.clone())).into_owned())
        .collect();
    assert!(!left.iter().any(|text| text.contains("(b)")));
    assert!(left.iter().any(|text| text.contains("(c)")));
    let root = after.catalog().unwrap().get(b"Pages").unwrap().as_reference().unwrap();
    assert_eq!(after.get_dictionary(root).unwrap().get(b"Count").unwrap().as_i64().unwrap(), 2);
}

#[test]
fn an_added_page_can_be_placed_anywhere() {
    let pdf = bytes(&mut labelled(&["a", "b"], false));
    let new = bytes(&mut labelled(&["new"], false));
    let out = apply_arranged(&pdf, &[Insert { at: 2, pdf: new }], Some(&[2, 0, 1]), &[]).unwrap();
    assert_eq!(labels(&out), ["new", "a", "b"]);
}

#[test]
fn edits_count_pages_in_the_new_order() {
    let pdf = bytes(&mut labelled(&["a", "b"], false));
    let edit = Edit {
        page: 0,
        markup: Some(markup()),
        absorbed: Vec::new(),
    };
    let out = apply_arranged(&pdf, &[], Some(&[1, 0]), &[edit]).unwrap();
    assert_eq!(labels(&out), ["b", "a"]);
    let opened = read(&out).unwrap();
    assert_eq!(opened.pages[0].as_deref(), Some(b"%PPK-moved".as_slice()));
    assert_eq!(opened.pages[1], None);
}

#[test]
fn a_nested_tree_is_flattened_keeping_what_pages_inherited() {
    let pdf = bytes(&mut labelled(&["a", "b", "c"], true));
    let out = apply_arranged(&pdf, &[], Some(&[1, 2, 0]), &[]).unwrap();
    assert_eq!(labels(&out), ["b", "c", "a"]);
    let doc = load(&out);
    for page in pages(&doc) {
        let media = doc.get_dictionary(page).unwrap().get(b"MediaBox").unwrap().as_array().unwrap();
        assert_eq!(media[3].as_float().unwrap(), 400.0);
    }
}

#[test]
fn a_bad_order_is_refused() {
    let pdf = bytes(&mut labelled(&["a", "b"], false));
    assert!(apply_arranged(&pdf, &[], Some(&[0, 0]), &[]).is_err());
    assert!(apply_arranged(&pdf, &[], Some(&[0, 5]), &[]).is_err());
    assert!(apply_arranged(&pdf, &[], Some(&[]), &[]).is_err());
}

#[test]
fn no_order_keeps_the_pages_as_they_are() {
    let pdf = bytes(&mut labelled(&["a", "b"], false));
    let out = apply_arranged(&pdf, &[], None, &[]).unwrap();
    assert_eq!(labels(&out), ["a", "b"]);
}

#[test]
fn the_bridge_takes_an_order() {
    let dir = std::env::temp_dir().join(format!("solstice-pages-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("doc.pdf");
    std::fs::write(&path, bytes(&mut labelled(&["a", "b", "c"], false))).unwrap();
    solstice_pdf::bridge::save(&path, r#"{"order":[2,1]}"#).unwrap();
    assert_eq!(labels(&std::fs::read(&path).unwrap()), ["c", "b"]);
    std::fs::remove_dir_all(dir).ok();
}
