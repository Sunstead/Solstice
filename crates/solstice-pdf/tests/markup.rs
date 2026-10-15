//! What Solstice writes into a PDF, checked on PDFs built here: one shaped
//! like a file the old PDFKit save left behind (orphans, Apple's copies of
//! every annotation, stamps hidden from every viewer), and plain ones.

use lopdf::{dictionary, Dictionary, Document, Object, ObjectId, Stream};
use solstice_pdf::{apply, read, repair, Edit, Insert, Link, Markup};

const KEY: &[u8] = b"SolsticeMarkup";

// -- Fixtures -----------------------------------------------------------

/// A plain PDF of `pages` letter pages, each saying which it is.
fn plain(pages: usize) -> Document {
    let mut doc = Document::with_version("1.7");
    let pages_id = doc.new_object_id();
    let mut kids = Vec::new();
    for n in 0..pages {
        let content = doc.add_object(Stream::new(
            dictionary! {},
            format!("BT /F1 12 Tf 72 720 Td (Page {n}) Tj ET").into_bytes(),
        ));
        let page = doc.add_object(dictionary! {
            "Type" => "Page",
            "Parent" => pages_id,
            "MediaBox" => vec![0.into(), 0.into(), 612.into(), 792.into()],
            "Contents" => content,
        });
        kids.push(Object::Reference(page));
    }
    doc.objects.insert(
        pages_id,
        Object::Dictionary(dictionary! {
            "Type" => "Pages",
            "Count" => pages as i64,
            "Kids" => kids,
        }),
    );
    let catalog = doc.add_object(dictionary! { "Type" => "Catalog", "Pages" => pages_id });
    doc.trailer.set("Root", catalog);
    doc
}

fn bytes(doc: &mut Document) -> Vec<u8> {
    let mut out = Vec::new();
    doc.save_to(&mut out).unwrap();
    out
}

fn page_ids(doc: &Document) -> Vec<ObjectId> {
    doc.get_pages().into_values().collect()
}

fn add_annotation(doc: &mut Document, page: ObjectId, annotation: Dictionary) -> ObjectId {
    let id = doc.add_object(annotation);
    let page = doc.get_dictionary_mut(page).unwrap();
    match page.get_mut(b"Annots") {
        Ok(Object::Array(annots)) => annots.push(id.into()),
        _ => page.set("Annots", vec![Object::Reference(id)]),
    }
    id
}

/// Apple's mirror of an annotation, as PDFKit adds to everything it writes.
fn apple_extras(of: &Dictionary) -> Object {
    Object::Dictionary(dictionary! {
        "AAPL:AKAnnotationObject" => Object::string_literal("YnBsaXN0MDA="),
        "AAPL:AKPDFAnnotationDictionary" => Object::Dictionary(of.clone()),
    })
}

/// Markup data for page `n`, as PaperKit would hand it over.
fn paperkit(n: usize, len: usize) -> Vec<u8> {
    let mut data = b"%PPK".to_vec();
    data.extend((0..len).map(|i| ((i * 31 + n * 7) % 251) as u8));
    data
}

/// A file as the old PDFKit save wrote it, `saves` saves in: per page, the
/// markup as a base64 string in a hidden square and a stamp whose flags
/// are `stamp_flags[page]`; Apple's copies; the orphans of earlier saves;
/// and an annotation of Preview's own, which isn't ours to touch.
fn legacy(stamp_flags: &[i64], saves: usize) -> Document {
    use base64::Engine;
    let mut doc = plain(stamp_flags.len());
    let pages = page_ids(&doc);
    for (n, (&page, &flags)) in pages.iter().zip(stamp_flags).enumerate() {
        let value = format!(
            "paperkit:{}",
            base64::engine::general_purpose::STANDARD.encode(paperkit(n, 2000))
        );
        let mut data = dictionary! {
            "Type" => "Annot", "Subtype" => "Square",
            "Rect" => vec![0.into(), 0.into(), 1.into(), 1.into()],
            "F" => 32, "Contents" => Object::string_literal("ink"),
            "SolsticeMarkup" => Object::string_literal(value),
        };
        data.set("AAPL:AKExtras", apple_extras(&data));
        add_annotation(&mut doc, page, data);

        let ap = doc.add_object(Stream::new(
            dictionary! { "Type" => "XObject", "Subtype" => "Form", "BBox" => vec![0.into(), 0.into(), 612.into(), 792.into()] },
            b"0 0 1 RG 100 100 m 200 200 l S".to_vec(),
        ));
        let mut stamp = dictionary! {
            "Type" => "Annot", "Subtype" => "Stamp",
            "Rect" => vec![0.into(), 0.into(), 612.into(), 792.into()],
            "F" => flags, "SolsticeMarkup" => Object::string_literal("copy"),
            "AP" => dictionary! { "N" => ap },
        };
        stamp.set("AAPL:AKExtras", apple_extras(&stamp));
        add_annotation(&mut doc, page, stamp);
    }
    let mut preview = dictionary! {
        "Type" => "Annot", "Subtype" => "Text",
        "Rect" => vec![10.into(), 10.into(), 30.into(), 30.into()],
        "Contents" => Object::string_literal("a note from Preview"),
    };
    preview.set("AAPL:AKExtras", apple_extras(&preview));
    add_annotation(&mut doc, pages[0], preview);

    // Every earlier save's annotations, still in the file.
    for n in 0..saves {
        doc.add_object(dictionary! {
            "Type" => "Annot", "Subtype" => "Square",
            "SolsticeMarkup" => Object::string_literal(format!("paperkit:{}", "A".repeat(4000 + n))),
        });
    }
    doc
}

/// The markup drawn as a page, as the app renders it: a vector path, with a
/// graphics state from its resources.
fn art() -> Vec<u8> {
    let mut doc = Document::with_version("1.4");
    let pages_id = doc.new_object_id();
    let gs = doc.add_object(dictionary! { "Type" => "ExtGState", "CA" => 0.5 });
    let content = doc.add_object(Stream::new(
        dictionary! {},
        b"/G0 gs 1 0 0 RG 50 50 m 300 300 l S".to_vec(),
    ));
    let page = doc.add_object(dictionary! {
        "Type" => "Page", "Parent" => pages_id,
        "MediaBox" => vec![0.into(), 0.into(), 612.into(), 792.into()],
        "Contents" => content,
        "Resources" => dictionary! { "ExtGState" => dictionary! { "G0" => gs } },
    });
    doc.objects.insert(
        pages_id,
        Object::Dictionary(
            dictionary! { "Type" => "Pages", "Count" => 1, "Kids" => vec![page.into()] },
        ),
    );
    let catalog = doc.add_object(dictionary! { "Type" => "Catalog", "Pages" => pages_id });
    doc.trailer.set("Root", catalog);
    bytes(&mut doc)
}

fn markup(n: usize) -> Markup {
    Markup {
        data: paperkit(n, 50_000),
        text: format!("handwriting on page {n}"),
        art: Some(art()),
        links: vec![],
    }
}

// -- Reading what was written ---------------------------------------------

fn load(pdf: &[u8]) -> Document {
    Document::load_mem(pdf).unwrap()
}

/// Our annotations on each page.
fn ours(doc: &Document) -> Vec<Vec<Dictionary>> {
    page_ids(doc)
        .into_iter()
        .map(|page| {
            doc.get_page_annotations(page)
                .unwrap_or_default()
                .into_iter()
                .filter(|a| a.has(KEY))
                .cloned()
                .collect()
        })
        .collect()
}

fn flags(annotation: &Dictionary) -> i64 {
    annotation.get(b"F").and_then(Object::as_i64).unwrap_or(0)
}

fn subtype(annotation: &Dictionary) -> &[u8] {
    annotation
        .get(b"Subtype")
        .and_then(Object::as_name)
        .unwrap_or(b"")
}

/// Every object in the file carrying our key, reachable or not.
fn our_objects(doc: &Document) -> usize {
    doc.objects
        .values()
        .filter(|o| o.as_dict().is_ok_and(|d| d.has(KEY)))
        .count()
}

// -- Tests --------------------------------------------------------------

#[test]
fn saving_again_and_again_keeps_the_file_the_same_size() {
    let mut pdf = bytes(&mut plain(2));
    let mut sizes = Vec::new();
    for save in 0..10 {
        pdf = apply(
            &pdf,
            &[],
            &[Edit {
                page: save % 2,
                markup: Some(markup(save)),
            }],
        )
        .unwrap();
        sizes.push(pdf.len());
    }
    // Both pages marked from the second save on: every save after is the
    // same size as the one before it, give or take the data's bytes.
    for pair in sizes[2..].windows(2) {
        assert!(pair[1].abs_diff(pair[0]) < 2_000, "sizes grew: {sizes:?}");
    }
    let doc = load(&pdf);
    assert_eq!(
        our_objects(&doc),
        2,
        "only the live annotations are in the file"
    );
    assert!(!read(&pdf).unwrap().needs_repair);
}

#[test]
fn every_page_stays_visible_after_editing_one() {
    // Pages 1 and 2 were left hidden (NoView) by the old save; page 3 wasn't.
    let pdf = bytes(&mut legacy(&[36, 36, 4], 0));
    let pdf = apply(
        &pdf,
        &[],
        &[Edit {
            page: 2,
            markup: Some(markup(2)),
        }],
    )
    .unwrap();
    for (n, page) in ours(&load(&pdf)).iter().enumerate() {
        let stamps: Vec<_> = page.iter().filter(|a| subtype(a) == b"Stamp").collect();
        assert_eq!(stamps.len(), 1, "page {n} has one stamp");
        assert_eq!(flags(stamps[0]) & (2 | 32), 0, "page {n}'s stamp is shown");
        assert_ne!(flags(stamps[0]) & 4, 0, "page {n}'s stamp prints");
    }
}

#[test]
fn apples_copies_go_from_our_annotations_only() {
    let pdf = repair(&bytes(&mut legacy(&[36, 4], 0))).unwrap();
    let doc = load(&pdf);
    for page in ours(&doc) {
        for annotation in page {
            assert!(!annotation.has(b"AAPL:AKExtras"));
        }
    }
    let first = page_ids(&doc)[0];
    let preview: Vec<_> = doc
        .get_page_annotations(first)
        .unwrap()
        .into_iter()
        .filter(|a| subtype(a) == b"Text")
        .collect();
    assert_eq!(preview.len(), 1, "Preview's note is kept");
    assert!(preview[0].has(b"AAPL:AKExtras"), "and left as it was");
}

#[test]
fn old_markup_is_read_and_carried_into_the_new_form() {
    let old = bytes(&mut legacy(&[36, 4], 3));
    let opened = read(&old).unwrap();
    assert!(opened.needs_repair);
    assert_eq!(
        opened.pages,
        vec![Some(paperkit(0, 2000)), Some(paperkit(1, 2000))]
    );

    let new = repair(&old).unwrap();
    let reopened = read(&new).unwrap();
    assert!(!reopened.needs_repair);
    assert_eq!(
        reopened.pages, opened.pages,
        "the markup survives byte for byte"
    );
    // One annotation per page now, the data in a stream on the stamp.
    for page in ours(&load(&new)) {
        assert_eq!(page.len(), 1);
        assert_eq!(subtype(&page[0]), b"Stamp");
    }
}

#[test]
fn a_bloated_file_is_compacted() {
    let old = bytes(&mut legacy(&[4, 4], 120));
    assert!(read(&old).unwrap().needs_repair);
    let new = repair(&old).unwrap();
    assert!(new.len() * 3 < old.len(), "{} -> {}", old.len(), new.len());
    assert_eq!(our_objects(&load(&new)), 2);
}

#[test]
fn a_pdf_without_our_marks_is_never_rewritten() {
    // Orphans of its own, but nothing of Solstice's: not ours to repair.
    let mut doc = plain(2);
    for _ in 0..10 {
        doc.add_object(dictionary! { "Junk" => 1 });
    }
    assert!(!read(&bytes(&mut doc)).unwrap().needs_repair);
}

#[test]
fn the_stamp_draws_the_markup() {
    let pdf = apply(
        &bytes(&mut plain(1)),
        &[],
        &[Edit {
            page: 0,
            markup: Some(markup(0)),
        }],
    )
    .unwrap();
    let doc = load(&pdf);
    let stamp = &ours(&doc)[0][0];
    assert_eq!(stamp.get(b"Rect").unwrap().as_array().unwrap().len(), 4);
    let form_id = stamp
        .get(b"AP")
        .and_then(Object::as_dict)
        .and_then(|ap| ap.get(b"N"))
        .and_then(Object::as_reference)
        .unwrap();
    let form = doc.get_object(form_id).and_then(Object::as_stream).unwrap();
    assert_eq!(
        form.dict.get(b"Subtype").and_then(Object::as_name).unwrap(),
        b"Form"
    );
    let content = form.decompressed_content().unwrap();
    assert!(String::from_utf8_lossy(&content).contains("300 300 l"));
    // The art's graphics state came along with it.
    let resources = form
        .dict
        .get(b"Resources")
        .and_then(Object::as_dict)
        .unwrap();
    let gs = resources
        .get(b"ExtGState")
        .and_then(Object::as_dict)
        .and_then(|d| d.get(b"G0"))
        .and_then(Object::as_reference)
        .unwrap();
    let gs = doc.get_dictionary(gs).unwrap();
    assert_eq!(gs.get(b"CA").and_then(Object::as_float).unwrap(), 0.5);
    // What the reader's search finds.
    assert!(stamp.has(b"Contents"));
}

#[test]
fn links_stay_links() {
    let mut with_link = markup(0);
    with_link.links.push(Link {
        rect: [10.0, 20.0, 110.0, 40.0],
        url: "https://example.com".into(),
    });
    let pdf = apply(
        &bytes(&mut plain(1)),
        &[],
        &[Edit {
            page: 0,
            markup: Some(with_link),
        }],
    )
    .unwrap();
    let doc = load(&pdf);
    let links: Vec<_> = ours(&doc)[0]
        .iter()
        .filter(|a| subtype(a) == b"Link")
        .cloned()
        .collect();
    assert_eq!(links.len(), 1);
    let action = links[0].get(b"A").and_then(Object::as_dict).unwrap();
    assert_eq!(
        action.get(b"URI").and_then(Object::as_str).unwrap(),
        b"https://example.com"
    );
}

#[test]
fn clearing_a_page_leaves_other_annotations() {
    let pdf = bytes(&mut legacy(&[4, 4], 0));
    let pdf = apply(
        &pdf,
        &[],
        &[Edit {
            page: 0,
            markup: None,
        }],
    )
    .unwrap();
    let doc = load(&pdf);
    assert!(ours(&doc)[0].is_empty());
    assert_eq!(ours(&doc)[1].len(), 1);
    let first = page_ids(&doc)[0];
    assert_eq!(
        doc.get_page_annotations(first).unwrap().len(),
        1,
        "Preview's note is still there"
    );
    assert_eq!(read(&pdf).unwrap().pages[0], None);
}

#[test]
fn added_pages_go_where_asked() {
    let template = art();
    let pdf = apply(
        &bytes(&mut plain(2)),
        &[Insert {
            at: 1,
            pdf: template.clone(),
        }],
        &[],
    )
    .unwrap();
    let doc = load(&pdf);
    let pages = page_ids(&doc);
    assert_eq!(pages.len(), 3);
    let added = doc.get_page_content(pages[1]);
    assert!(String::from_utf8_lossy(&added).contains("300 300 l"));
    let root = doc
        .catalog()
        .unwrap()
        .get(b"Pages")
        .and_then(Object::as_reference)
        .unwrap();
    assert_eq!(
        doc.get_dictionary(root)
            .unwrap()
            .get(b"Count")
            .and_then(Object::as_i64)
            .unwrap(),
        3
    );

    // Then marked up, in the same save.
    let pdf = apply(
        &bytes(&mut plain(1)),
        &[Insert {
            at: 1,
            pdf: template,
        }],
        &[Edit {
            page: 1,
            markup: Some(markup(1)),
        }],
    )
    .unwrap();
    assert_eq!(read(&pdf).unwrap().pages, vec![None, Some(markup(1).data)]);
}

#[test]
fn added_pages_count_up_a_nested_tree() {
    // Two pages under an intermediate node, as long documents are built.
    let mut doc = plain(2);
    let root = doc
        .catalog()
        .unwrap()
        .get(b"Pages")
        .and_then(Object::as_reference)
        .unwrap();
    let kids = doc
        .get_dictionary(root)
        .unwrap()
        .get(b"Kids")
        .unwrap()
        .clone();
    let middle = doc.add_object(
        dictionary! { "Type" => "Pages", "Parent" => root, "Count" => 2, "Kids" => kids.clone() },
    );
    for kid in kids.as_array().unwrap() {
        doc.get_dictionary_mut(kid.as_reference().unwrap())
            .unwrap()
            .set("Parent", middle);
    }
    let root_dict = doc.get_dictionary_mut(root).unwrap();
    root_dict.set("Kids", vec![Object::Reference(middle)]);

    let pdf = apply(&bytes(&mut doc), &[Insert { at: 2, pdf: art() }], &[]).unwrap();
    let doc = load(&pdf);
    assert_eq!(page_ids(&doc).len(), 3);
    let root = doc
        .catalog()
        .unwrap()
        .get(b"Pages")
        .and_then(Object::as_reference)
        .unwrap();
    assert_eq!(
        doc.get_dictionary(root)
            .unwrap()
            .get(b"Count")
            .and_then(Object::as_i64)
            .unwrap(),
        3
    );
}

#[test]
fn the_bridge_saves_through_a_temporary_file() {
    use base64::Engine;
    let b64 = |b: &[u8]| base64::engine::general_purpose::STANDARD.encode(b);
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("notes.pdf");
    std::fs::write(&path, bytes(&mut plain(2))).unwrap();

    let request = serde_json::json!({
        "inserts": [],
        "edits": [{ "page": 1, "markup": {
            "data": b64(&markup(1).data), "text": "hi", "art": b64(&art()), "links": [],
        }}],
    });
    let saved = solstice_pdf::bridge::save(&path, &request.to_string()).unwrap();
    let written = std::fs::read(&path).unwrap();
    let saved: serde_json::Value = serde_json::from_str(&saved).unwrap();
    assert_eq!(saved["hash"], solstice_pdf::content_hash(&written));
    let names: Vec<_> = std::fs::read_dir(dir.path())
        .unwrap()
        .map(|e| e.unwrap().file_name())
        .collect();
    assert_eq!(names.len(), 1, "no temporary file is left: {names:?}");

    let opened: serde_json::Value =
        serde_json::from_str(&solstice_pdf::bridge::read(&path).unwrap()).unwrap();
    assert_eq!(opened["pages"][0], serde_json::Value::Null);
    assert_eq!(opened["pages"][1], b64(&markup(1).data));
    assert_eq!(opened["needsRepair"], false);
}

/// `cargo test -p solstice-pdf --release -- --ignored --nocapture`
#[test]
#[ignore]
fn saving_a_long_pdf_is_quick() {
    let mut doc = plain(300);
    for page in page_ids(&doc) {
        let image = doc.add_object(Stream::new(
            dictionary! { "Type" => "XObject", "Subtype" => "Image" },
            vec![7; 60_000],
        ));
        doc.get_dictionary_mut(page).unwrap().set(
            "Resources",
            dictionary! { "XObject" => dictionary! { "Im0" => image } },
        );
    }
    let pdf = bytes(&mut doc);
    let start = std::time::Instant::now();
    let saved = apply(
        &pdf,
        &[],
        &[Edit {
            page: 150,
            markup: Some(markup(150)),
        }],
    )
    .unwrap();
    println!("{} MB in {:?}", saved.len() / 1_000_000, start.elapsed());
}

/// A real file: `SOLSTICE_PDF=<path> cargo test -p solstice-pdf --release
/// -- --ignored --nocapture repairs_a_real_file`. Writes `<path>.repaired.pdf`.
#[test]
#[ignore]
fn repairs_a_real_file() {
    let Ok(path) = std::env::var("SOLSTICE_PDF") else {
        return;
    };
    let old = std::fs::read(&path).unwrap();
    let start = std::time::Instant::now();
    let opened = read(&old).unwrap();
    let read_time = start.elapsed();
    let new = repair(&old).unwrap();
    println!(
        "{path}: needs repair {}, read {read_time:?}, {} -> {} bytes in {:?}",
        opened.needs_repair,
        old.len(),
        new.len(),
        start.elapsed()
    );
    assert_eq!(read(&new).unwrap().pages, opened.pages);
    std::fs::write(format!("{path}.repaired.pdf"), new).unwrap();
}
