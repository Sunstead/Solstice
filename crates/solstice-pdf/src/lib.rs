//! Solstice's handwritten marks in a PDF, written into the file itself so
//! every device and every reader shows them.
//!
//! Each marked page gets one stamp annotation: its appearance is the app's
//! own rendering of the marks (`Markup::art`, a one-page PDF), which any
//! reader draws, and it carries the PaperKit data in a compressed stream
//! (`/SolsticePaperKit`) so the iPad can edit the marks again. Links in the
//! marks become link annotations. Everything of ours carries
//! `/SolsticeMarkup`; other apps' annotations are left as they are.
//!
//! Every save rewrites the file with only what's reachable from its
//! trailer. PDFKit, which used to write these files, kept every annotation
//! it had ever removed and a second copy of each it kept (`AAPL:AKExtras`),
//! and wrote the stamps it was hiding on screen as hidden from every
//! viewer; files it wrote are repaired on open ([`Opened::needs_repair`]).
//!
//! Apple's Markup (Preview, Files) writes ink as a stamp whose appearance
//! is a picture, blurred at any zoom, with the ink itself in vector in an
//! archive under `AAPL:AKExtras` ([`AppleInk`]). The iPad takes that ink
//! into the page's own marks to draw it live, and the first save of the
//! page drops Apple's annotation ([`Edit::absorbed`]).

pub mod bridge;

use std::collections::{HashMap, HashSet};
use std::io::Write;
use std::path::Path;

use lopdf::{dictionary, Dictionary, Document, Object, ObjectId, Stream, StringFormat};
use sha2::{Digest, Sha256};

/// On every annotation of ours: `copy` on the stamp and links; legacy
/// files hold `paperkit:<base64>` on a hidden square instead.
const KEY: &[u8] = b"SolsticeMarkup";
/// The PaperKit data, a stream, on the stamp (or, for a repaired file whose
/// page had no stamp, on a hidden square marked `data`).
const DATA_KEY: &[u8] = b"SolsticePaperKit";
const COPY: &[u8] = b"copy";
const DATA: &[u8] = b"data";
const LEGACY_PREFIX: &[u8] = b"paperkit:";
const APPLE_EXTRAS: &[u8] = b"AAPL:AKExtras";
/// In Apple's extras: the archived annotation (`AKInkAnnotation2` for ink).
const APPLE_ARCHIVE: &[u8] = b"AAPL:AKAnnotationV2";

/// Annotation flags (PDF 32000, 12.5.3).
const HIDDEN: i64 = 2;
const PRINT: i64 = 4;
const NO_VIEW: i64 = 32;

pub type Result<T> = std::result::Result<T, String>;

/// The error for an encrypted PDF, which callers may check for.
pub const ENCRYPTED: &str = "This PDF is encrypted.";

/// A link in the marks, in page space (`[x0, y0, x1, y1]`).
#[derive(Debug, Clone)]
pub struct Link {
    pub rect: [f32; 4],
    pub url: String,
}

/// One page's marks.
#[derive(Debug, Clone)]
pub struct Markup {
    /// PaperKit's data representation.
    pub data: Vec<u8>,
    /// What's written, for readers' search.
    pub text: String,
    /// The marks drawn as a one-page PDF the size of the page's crop box.
    pub art: Option<Vec<u8>>,
    pub links: Vec<Link>,
}

/// Replaces a page's marks with `markup`, or removes them (`None`).
#[derive(Debug, Clone)]
pub struct Edit {
    /// Zero-based, counted after this save's inserts.
    pub page: usize,
    pub markup: Option<Markup>,
    /// [`AppleInk::fingerprint`]s of Apple's annotations on the page whose
    /// ink is now in `markup`: they go, unless changed since.
    pub absorbed: Vec<String>,
}

/// An annotation of Apple's Markup on a page, as written: its archive (an
/// `AKInkAnnotation2`'s holds a `PKDrawing`), and where it is, in page space.
#[derive(Debug, Clone, PartialEq)]
pub struct AppleInk {
    /// The archive's [`content_hash`]: which annotation, as it was read.
    pub fingerprint: String,
    pub archive: Vec<u8>,
    /// `[x0, y0, x1, y1]`.
    pub rect: [f32; 4],
}

/// A page added at `at` (zero-based), copied from a one-page PDF.
#[derive(Debug, Clone)]
pub struct Insert {
    pub at: usize,
    pub pdf: Vec<u8>,
}

#[derive(Debug)]
pub struct Opened {
    /// Each page's PaperKit data, if it has marks of ours.
    pub pages: Vec<Option<Vec<u8>>>,
    /// Each page's annotations of Apple's Markup.
    pub apple: Vec<Vec<AppleInk>>,
    /// The file has marks of ours and was written badly (an old save):
    /// [`repair`] it.
    pub needs_repair: bool,
}

/// The marks on every page of `pdf`.
/// An encrypted PDF is refused: saving it here would drop its encryption,
/// so the app leaves those to PDFKit.
pub fn read(pdf: &[u8]) -> Result<Opened> {
    let doc = load(pdf)?;
    if doc.is_encrypted() || doc.was_encrypted() {
        return Err(ENCRYPTED.into());
    }
    let mut pages = Vec::new();
    let mut apple = Vec::new();
    let mut ours = false;
    let mut badly_written = false;
    for page in doc.get_pages().into_values() {
        let mut data = None;
        let mut inks = Vec::new();
        for (_, annotation) in annotations(&doc, page) {
            let Some(kind) = marker(annotation) else {
                if let Some(archive) = apple_archive(&doc, annotation) {
                    inks.push(AppleInk {
                        fingerprint: content_hash(&archive),
                        archive,
                        rect: rect(&doc, annotation),
                    });
                }
                continue;
            };
            ours = true;
            if let Some(found) = paperkit_data(&doc, annotation) {
                data.get_or_insert(found);
            }
            badly_written |= kind.starts_with(LEGACY_PREFIX)
                || annotation.has(APPLE_EXTRAS)
                || (kind == COPY && flags(annotation) & (HIDDEN | NO_VIEW) != 0);
        }
        pages.push(data);
        apple.push(inks);
    }
    let needs_repair = ours && (badly_written || has_orphans(&doc));
    Ok(Opened {
        pages,
        apple,
        needs_repair,
    })
}

/// What's written on a page, for search.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct PageText {
    /// The page's own text.
    pub text: String,
    /// The handwriting recognised in our marks on it.
    pub handwriting: String,
}

/// Each page's text and handwriting. A page whose text can't be read has
/// none, rather than failing the rest.
pub fn page_texts(pdf: &[u8]) -> Result<Vec<PageText>> {
    /// Per page, so a small stream can't inflate without bound.
    const MAX_CONTENT: usize = 64 << 20;
    let doc = load(pdf)?;
    if doc.is_encrypted() {
        return Err(ENCRYPTED.into());
    }
    Ok(doc
        .get_pages()
        .into_iter()
        .map(|(number, page)| {
            let text = doc
                .extract_text_chunks_with_limit(&[number], MAX_CONTENT)
                .into_iter()
                .filter_map(std::result::Result::ok)
                .collect::<String>();
            let handwriting = annotations(&doc, page)
                .into_iter()
                .filter(|(_, a)| marker(a) == Some(COPY))
                .filter_map(|(_, a)| lopdf::decode_text_string(a.get(b"Contents").ok()?).ok())
                .filter(|t| !t.is_empty())
                .collect::<Vec<_>>()
                .join("\n");
            PageText { text, handwriting }
        })
        .collect())
}

/// `pdf` with `inserts` added, then `edits` made, written compactly.
/// Marks of ours an old save wrote badly are put right on the way.
pub fn apply(pdf: &[u8], inserts: &[Insert], edits: &[Edit]) -> Result<Vec<u8>> {
    apply_arranged(pdf, inserts, None, edits)
}

/// As [`apply`], with the pages then put in `order`: indices of the pages
/// after the inserts, each at most once; pages left out are deleted (the
/// iPad's page sheet). `edits` count pages in the new order.
pub fn apply_arranged(
    pdf: &[u8],
    inserts: &[Insert],
    order: Option<&[usize]>,
    edits: &[Edit],
) -> Result<Vec<u8>> {
    let mut doc = load(pdf)?;
    if doc.is_encrypted() || doc.was_encrypted() {
        return Err(ENCRYPTED.into());
    }
    for insert in inserts {
        insert_page(&mut doc, insert)?;
    }
    if let Some(order) = order {
        arrange(&mut doc, order)?;
    }
    let pages: Vec<ObjectId> = doc.get_pages().into_values().collect();
    for &page in &pages {
        normalise(&mut doc, page);
    }
    for edit in edits {
        let page = *pages
            .get(edit.page)
            .ok_or_else(|| format!("No page {}.", edit.page + 1))?;
        if !edit.absorbed.is_empty() {
            let absorbed: Vec<Slot> = annotations(&doc, page)
                .into_iter()
                .filter(|(_, a)| {
                    apple_archive(&doc, a)
                        .is_some_and(|archive| edit.absorbed.contains(&content_hash(&archive)))
                })
                .map(|(slot, _)| slot)
                .collect();
            remove_annotations(&mut doc, page, |slot, _| absorbed.contains(&slot));
        }
        replace_marks(&mut doc, page, edit.markup.as_ref())?;
    }
    prune(&mut doc);
    let mut out = Vec::new();
    doc.save_modern(&mut out).map_err(|e| e.to_string())?;
    Ok(out)
}

/// `pdf` with its marks written as [`apply`] writes them.
pub fn repair(pdf: &[u8]) -> Result<Vec<u8>> {
    apply(pdf, &[], &[])
}

/// Replaces `path` with `bytes` through a temporary file beside it (hidden,
/// so the folder's sync never takes it for a note), so nothing ever reads
/// half a PDF. Returns the content's hash.
pub fn write_atomically(path: &Path, bytes: &[u8]) -> std::io::Result<String> {
    let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("pdf");
    let temporary = path.with_file_name(format!(".{name}.saving"));
    let written = (|| {
        let mut file = std::fs::File::create(&temporary)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        std::fs::rename(&temporary, path)
    })();
    if written.is_err() {
        let _ = std::fs::remove_file(&temporary);
    }
    written.map(|()| content_hash(bytes))
}

/// SHA-256, hex: what Solstice Sync calls a file's content.
pub fn content_hash(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

// -- Reading ------------------------------------------------------------

fn load(pdf: &[u8]) -> Result<Document> {
    Document::load_mem(pdf).map_err(|e| format!("Couldn't read this PDF: {e}"))
}

/// Where an annotation sits in its page's `/Annots`.
#[derive(Clone, Copy, PartialEq)]
enum Slot {
    Object(ObjectId),
    Inline(usize),
}

/// A page's annotations, resolved.
fn annotations(doc: &Document, page: ObjectId) -> Vec<(Slot, &Dictionary)> {
    let Some(list) = annots_array(doc, page) else {
        return Vec::new();
    };
    list.iter()
        .enumerate()
        .filter_map(|(index, item)| match item {
            Object::Reference(id) => doc.get_dictionary(*id).ok().map(|d| (Slot::Object(*id), d)),
            Object::Dictionary(d) => Some((Slot::Inline(index), d)),
            _ => None,
        })
        .collect()
}

fn annots_array(doc: &Document, page: ObjectId) -> Option<&Vec<Object>> {
    let annots = doc.get_dictionary(page).ok()?.get(b"Annots").ok()?;
    match annots {
        Object::Reference(id) => doc.get_object(*id).ok()?.as_array().ok(),
        other => other.as_array().ok(),
    }
}

/// The value of our key, if the annotation is ours.
fn marker(annotation: &Dictionary) -> Option<&[u8]> {
    annotation.get(KEY).ok()?.as_str().ok()
}

fn flags(annotation: &Dictionary) -> i64 {
    annotation.get(b"F").and_then(Object::as_i64).unwrap_or(0)
}

fn paperkit_data(doc: &Document, annotation: &Dictionary) -> Option<Vec<u8>> {
    if let Ok(found) = annotation.get(DATA_KEY) {
        let (_, stream) = doc.dereference(found).ok()?;
        return stream.as_stream().ok()?.decompressed_content().ok();
    }
    let legacy = marker(annotation)?.strip_prefix(LEGACY_PREFIX)?;
    decode_base64(legacy)
}

/// The archive of an annotation of Apple's Markup, if it is one.
fn apple_archive(doc: &Document, annotation: &Dictionary) -> Option<Vec<u8>> {
    let extras = annotation.get(APPLE_EXTRAS).ok()?;
    let (_, extras) = doc.dereference(extras).ok()?;
    let archive = extras.as_dict().ok()?.get(APPLE_ARCHIVE).ok()?;
    let (_, archive) = doc.dereference(archive).ok()?;
    decode_base64(archive.as_str().ok()?)
}

/// An annotation's `/Rect`, ordered.
fn rect(doc: &Document, annotation: &Dictionary) -> [f32; 4] {
    let numbers: Vec<f32> = annotation
        .get(b"Rect")
        .ok()
        .and_then(|o| doc.dereference(o).ok())
        .and_then(|(_, o)| o.as_array().ok())
        .map(|a| a.iter().filter_map(|v| v.as_float().ok()).collect())
        .unwrap_or_default();
    match numbers[..] {
        [a, b, c, d] => [a.min(c), b.min(d), a.max(c), b.max(d)],
        _ => [0.0; 4],
    }
}

fn decode_base64(text: &[u8]) -> Option<Vec<u8>> {
    use base64::Engine;
    let clean: Vec<u8> = text
        .iter()
        .copied()
        .filter(|b| !b.is_ascii_whitespace())
        .collect();
    base64::engine::general_purpose::STANDARD.decode(clean).ok()
}

/// Objects the trailer doesn't reach: what PDFKit's saves left behind.
fn has_orphans(doc: &Document) -> bool {
    let reachable = reachable(doc);
    doc.objects
        .iter()
        .any(|(id, object)| !reachable.contains(id) && !is_structural(object))
}

/// Object and cross-reference streams: the file's own bookkeeping, never
/// referenced.
fn is_structural(object: &Object) -> bool {
    object
        .type_name()
        .is_ok_and(|name| name == b"ObjStm" || name == b"XRef")
}

// -- Writing ------------------------------------------------------------

/// Puts right what an old save wrote: Apple's copies of our annotations
/// go, our stamps and links are shown, and markup data in a base64 string
/// moves into a stream on the page's stamp.
fn normalise(doc: &mut Document, page: ObjectId) {
    let mut legacy: Option<(Slot, Vec<u8>)> = None;
    let mut stamp: Option<Slot> = None;
    let mut slots = Vec::new();
    for (slot, annotation) in annotations(doc, page) {
        let Some(kind) = marker(annotation) else {
            continue;
        };
        if kind.starts_with(LEGACY_PREFIX) {
            if let Some(data) = paperkit_data(doc, annotation) {
                legacy.get_or_insert((slot, data));
            }
        } else if kind == COPY
            && annotation.get(b"Subtype").and_then(Object::as_name).ok() == Some(b"Stamp")
        {
            stamp.get_or_insert(slot);
        }
        slots.push((slot, kind == COPY));
    }

    for &(slot, shown) in &slots {
        if let Some(annotation) = annotation_mut(doc, page, slot) {
            annotation.remove(APPLE_EXTRAS);
            if shown {
                annotation.set("F", (flags(annotation) & !(HIDDEN | NO_VIEW)) | PRINT);
            }
        }
    }

    let Some((square, data)) = legacy else { return };
    let stream = doc.add_object(data_stream(data));
    match stamp.and_then(|slot| annotation_mut(doc, page, slot)) {
        Some(stamp) => {
            stamp.set(DATA_KEY, stream);
            remove_annotations(doc, page, |slot, _| slot == square);
        }
        None => {
            if let Some(square) = annotation_mut(doc, page, square) {
                square.set(KEY, Object::string_literal(DATA));
                square.set(DATA_KEY, stream);
                square.set("F", HIDDEN | NO_VIEW);
            }
        }
    }
    // Any further legacy squares on the page are older copies.
    remove_annotations(doc, page, |_, a| {
        marker(a).is_some_and(|k| k.starts_with(LEGACY_PREFIX))
    });
}

fn annotation_mut(doc: &mut Document, page: ObjectId, slot: Slot) -> Option<&mut Dictionary> {
    match slot {
        Slot::Object(id) => doc.get_dictionary_mut(id).ok(),
        Slot::Inline(index) => annots_array_mut(doc, page)?
            .get_mut(index)?
            .as_dict_mut()
            .ok(),
    }
}

fn annots_array_mut(doc: &mut Document, page: ObjectId) -> Option<&mut Vec<Object>> {
    let indirect = match doc.get_dictionary(page).ok()?.get(b"Annots").ok()? {
        Object::Reference(id) => Some(*id),
        _ => None,
    };
    match indirect {
        Some(id) => doc.get_object_mut(id).ok()?.as_array_mut().ok(),
        None => doc
            .get_dictionary_mut(page)
            .ok()?
            .get_mut(b"Annots")
            .ok()?
            .as_array_mut()
            .ok(),
    }
}

/// Drops the annotations `drop` picks from the page's `/Annots`; their
/// objects go when the file is pruned.
fn remove_annotations(
    doc: &mut Document,
    page: ObjectId,
    drop: impl Fn(Slot, &Dictionary) -> bool,
) {
    let dropped: HashSet<usize> = {
        let Some(list) = annots_array(doc, page) else {
            return;
        };
        list.iter()
            .enumerate()
            .filter(|(index, item)| match item {
                Object::Reference(id) => doc
                    .get_dictionary(*id)
                    .is_ok_and(|d| drop(Slot::Object(*id), d)),
                Object::Dictionary(d) => drop(Slot::Inline(*index), d),
                _ => false,
            })
            .map(|(index, _)| index)
            .collect()
    };
    if dropped.is_empty() {
        return;
    }
    if let Some(list) = annots_array_mut(doc, page) {
        let mut index = 0;
        list.retain(|_| {
            let keep = !dropped.contains(&index);
            index += 1;
            keep
        });
    }
}

fn replace_marks(doc: &mut Document, page: ObjectId, markup: Option<&Markup>) -> Result<()> {
    remove_annotations(doc, page, |_, a| marker(a).is_some());
    let Some(markup) = markup.filter(|m| !m.data.is_empty()) else {
        drop_empty_annots(doc, page);
        return Ok(());
    };

    let box_ = crop_box(doc, page);
    let rect = Object::Array(box_.iter().map(|&v| Object::Real(v)).collect());
    let size = [box_[2] - box_[0], box_[3] - box_[1]];
    let data = doc.add_object(data_stream(markup.data.clone()));
    let mut stamp = dictionary! {
        "Type" => "Annot",
        "Subtype" => "Stamp",
        "Rect" => rect,
        "F" => PRINT,
        "P" => page,
        "Contents" => text_string(&markup.text),
    };
    stamp.set(KEY, Object::string_literal(COPY));
    stamp.set(DATA_KEY, data);
    let form = match &markup.art {
        Some(art) => import_art(doc, art, size)?,
        None => doc.add_object(form(size, Dictionary::new(), Vec::new())),
    };
    stamp.set("AP", dictionary! { "N" => form });
    let mut added = vec![Object::Reference(doc.add_object(stamp))];

    for link in &markup.links {
        let mut annotation = dictionary! {
            "Type" => "Annot",
            "Subtype" => "Link",
            "Rect" => link.rect.iter().map(|&v| Object::Real(v)).collect::<Vec<_>>(),
            "Border" => vec![0.into(), 0.into(), 0.into()],
            "F" => PRINT,
            "P" => page,
            "A" => dictionary! { "S" => "URI", "URI" => Object::string_literal(link.url.as_str()) },
        };
        annotation.set(KEY, Object::string_literal(COPY));
        added.push(Object::Reference(doc.add_object(annotation)));
    }

    match annots_array_mut(doc, page) {
        Some(list) => list.extend(added),
        None => doc
            .get_dictionary_mut(page)
            .map_err(|e| e.to_string())?
            .set("Annots", added),
    }
    Ok(())
}

fn drop_empty_annots(doc: &mut Document, page: ObjectId) {
    if annots_array(doc, page).is_some_and(Vec::is_empty) {
        if let Ok(page) = doc.get_dictionary_mut(page) {
            page.remove(b"Annots");
        }
    }
}

fn data_stream(data: Vec<u8>) -> Stream {
    use flate2::{write::ZlibEncoder, Compression};
    let mut encoder = ZlibEncoder::new(Vec::new(), Compression::default());
    let compressed = encoder.write_all(&data).and_then(|()| encoder.finish());
    match compressed {
        Ok(compressed) => Stream::new(dictionary! { "Filter" => "FlateDecode" }, compressed),
        Err(_) => Stream::new(Dictionary::new(), data),
    }
}

fn form(size: [f32; 2], resources: Dictionary, content: Vec<u8>) -> Stream {
    let mut stream = Stream::new(
        dictionary! {
            "Type" => "XObject",
            "Subtype" => "Form",
            "BBox" => vec![0.into(), 0.into(), Object::Real(size[0]), Object::Real(size[1])],
            "Resources" => resources,
        },
        content,
    );
    let _ = stream.compress();
    stream
}

/// A PDF text string: plain when it's ASCII, else UTF-16 with its mark.
fn text_string(text: &str) -> Object {
    if text.is_ascii() {
        return Object::string_literal(text);
    }
    let mut bytes = vec![0xfe, 0xff];
    bytes.extend(text.encode_utf16().flat_map(u16::to_be_bytes));
    Object::String(bytes, StringFormat::Hexadecimal)
}

/// The page's crop box (inherited, or its media box), `[x0, y0, x1, y1]`.
fn crop_box(doc: &Document, page: ObjectId) -> [f32; 4] {
    let found = inherited(doc, page, b"CropBox").or_else(|| inherited(doc, page, b"MediaBox"));
    let numbers: Vec<f32> = found
        .and_then(|o| doc.dereference(o).ok())
        .and_then(|(_, o)| o.as_array().ok())
        .map(|a| a.iter().filter_map(|v| v.as_float().ok()).collect())
        .unwrap_or_default();
    match numbers[..] {
        [a, b, c, d] => [a.min(c), b.min(d), a.max(c), b.max(d)],
        _ => [0.0, 0.0, 612.0, 792.0],
    }
}

/// A page attribute, from the page or the nearest node above it.
fn inherited<'a>(doc: &'a Document, page: ObjectId, key: &[u8]) -> Option<&'a Object> {
    let mut node = doc.get_dictionary(page).ok()?;
    for _ in 0..64 {
        if let Ok(value) = node.get(key) {
            return Some(value);
        }
        node = doc
            .get_dictionary(node.get(b"Parent").ok()?.as_reference().ok()?)
            .ok()?;
    }
    None
}

/// The art's page as a form, its resources copied into `doc`.
fn import_art(doc: &mut Document, art: &[u8], size: [f32; 2]) -> Result<ObjectId> {
    let source = load(art)?;
    let page = *source
        .get_pages()
        .values()
        .next()
        .ok_or("The markup's rendering has no page.")?;
    let content = source.get_page_content(page);
    let resources = inherited(&source, page, b"Resources")
        .cloned()
        .unwrap_or(Object::Dictionary(Dictionary::new()));
    let resources = match copy_into(&source, &resources, doc) {
        Object::Reference(id) => doc.get_dictionary(id).cloned().unwrap_or_default(),
        Object::Dictionary(d) => d,
        _ => Dictionary::new(),
    };
    Ok(doc.add_object(form(size, resources, content)))
}

/// Copies `root` and everything it reaches in `source` into `doc`, under
/// new ids. Returns `root` with its references renumbered.
fn copy_into(source: &Document, root: &Object, doc: &mut Document) -> Object {
    let mut ids: HashMap<ObjectId, ObjectId> = HashMap::new();
    let mut queue: Vec<ObjectId> = Vec::new();
    collect_refs(root, &mut |id| queue.push(id));
    while let Some(id) = queue.pop() {
        if ids.contains_key(&id) || !source.objects.contains_key(&id) {
            continue;
        }
        ids.insert(id, doc.new_object_id());
        collect_refs(&source.objects[&id], &mut |next| queue.push(next));
    }
    for (old, new) in &ids {
        let mut object = source.objects[old].clone();
        renumber(&mut object, &ids);
        doc.objects.insert(*new, object);
    }
    let mut root = root.clone();
    renumber(&mut root, &ids);
    root
}

fn collect_refs(object: &Object, found: &mut impl FnMut(ObjectId)) {
    match object {
        Object::Reference(id) => found(*id),
        Object::Array(items) => items.iter().for_each(|o| collect_refs(o, found)),
        Object::Dictionary(d) => d.iter().for_each(|(_, o)| collect_refs(o, found)),
        Object::Stream(s) => s.dict.iter().for_each(|(_, o)| collect_refs(o, found)),
        _ => {}
    }
}

fn renumber(object: &mut Object, ids: &HashMap<ObjectId, ObjectId>) {
    match object {
        Object::Reference(id) => {
            if let Some(new) = ids.get(id) {
                *id = *new;
            }
        }
        Object::Array(items) => items.iter_mut().for_each(|o| renumber(o, ids)),
        Object::Dictionary(d) => d.iter_mut().for_each(|(_, o)| renumber(o, ids)),
        Object::Stream(s) => s.dict.iter_mut().for_each(|(_, o)| renumber(o, ids)),
        _ => {}
    }
}

/// Adds the insert's page to `doc` at `insert.at`, beside the page it
/// follows (or precedes, at the start) in the page tree.
fn insert_page(doc: &mut Document, insert: &Insert) -> Result<()> {
    let source = load(&insert.pdf)?;
    let source_page = *source
        .get_pages()
        .values()
        .next()
        .ok_or("The new page's PDF has no page.")?;
    let mut page = source
        .get_dictionary(source_page)
        .map_err(|e| e.to_string())?
        .clone();
    for key in [b"MediaBox".as_slice(), b"CropBox", b"Resources", b"Rotate"] {
        if !page.has(key) {
            if let Some(value) = inherited(&source, source_page, key) {
                page.set(key, value.clone());
            }
        }
    }
    page.remove(b"Parent");
    page.remove(b"Annots");
    let page = match copy_into(&source, &Object::Dictionary(page), doc) {
        Object::Dictionary(d) => d,
        _ => unreachable!("a dictionary copies as one"),
    };

    let pages: Vec<ObjectId> = doc.get_pages().into_values().collect();
    let (anchor, after) = match insert.at {
        0 => (*pages.first().ok_or("This PDF has no pages.")?, false),
        at => (
            *pages.get(at - 1).ok_or_else(|| format!("No page {at}."))?,
            true,
        ),
    };
    let parent = doc
        .get_dictionary(anchor)
        .and_then(|d| d.get(b"Parent"))
        .and_then(Object::as_reference)
        .map_err(|e| e.to_string())?;
    let mut page = page;
    page.set("Parent", parent);
    let id = doc.add_object(page);

    let kids = kids_mut(doc, parent).ok_or("The page tree is damaged.")?;
    let index = kids
        .iter()
        .position(|k| k.as_reference().ok() == Some(anchor))
        .ok_or("The page tree is damaged.")?;
    kids.insert(if after { index + 1 } else { index }, Object::Reference(id));

    let mut node = Some(parent);
    for _ in 0..64 {
        let Some(id) = node else { break };
        let Ok(dict) = doc.get_dictionary_mut(id) else {
            break;
        };
        let count = dict.get(b"Count").and_then(Object::as_i64).unwrap_or(0);
        dict.set("Count", count + 1);
        node = dict.get(b"Parent").and_then(Object::as_reference).ok();
    }
    Ok(())
}

/// Puts the pages in `order` (indices into the pages as they are) as the
/// root's only kids: a flat tree, each page carrying what it inherited from
/// the nodes that go. Pages left out are no longer reached, and pruned.
fn arrange(doc: &mut Document, order: &[usize]) -> Result<()> {
    let pages: Vec<ObjectId> = doc.get_pages().into_values().collect();
    if order.is_empty() {
        return Err("A PDF needs at least one page.".into());
    }
    let mut seen = HashSet::new();
    for &i in order {
        if i >= pages.len() || !seen.insert(i) {
            return Err(format!("No page {} to put there.", i + 1));
        }
    }
    let root = doc
        .catalog()
        .and_then(|c| c.get(b"Pages"))
        .and_then(Object::as_reference)
        .map_err(|_| "The page tree is damaged.".to_string())?;
    let mut kids = Vec::with_capacity(order.len());
    for &i in order {
        let page = pages[i];
        let carried: Vec<(&[u8], Object)> = [b"MediaBox".as_slice(), b"CropBox", b"Resources", b"Rotate"]
            .into_iter()
            .filter(|key| doc.get_dictionary(page).is_ok_and(|d| !d.has(key)))
            .filter_map(|key| inherited(doc, page, key).map(|value| (key, value.clone())))
            .collect();
        let dict = doc.get_dictionary_mut(page).map_err(|e| e.to_string())?;
        for (key, value) in carried {
            dict.set(key, value);
        }
        dict.set("Parent", root);
        kids.push(Object::Reference(page));
    }
    let count = kids.len() as i64;
    let node = doc.get_dictionary_mut(root).map_err(|e| e.to_string())?;
    node.set("Kids", kids);
    node.set("Count", count);
    Ok(())
}

fn kids_mut(doc: &mut Document, node: ObjectId) -> Option<&mut Vec<Object>> {
    let indirect = match doc.get_dictionary(node).ok()?.get(b"Kids").ok()? {
        Object::Reference(id) => Some(*id),
        _ => None,
    };
    match indirect {
        Some(id) => doc.get_object_mut(id).ok()?.as_array_mut().ok(),
        None => doc
            .get_dictionary_mut(node)
            .ok()?
            .get_mut(b"Kids")
            .ok()?
            .as_array_mut()
            .ok(),
    }
}

// -- Pruning ------------------------------------------------------------

/// Every object the trailer reaches. lopdf's own walk is quadratic, too
/// slow for a long textbook.
fn reachable(doc: &Document) -> HashSet<ObjectId> {
    let mut seen = HashSet::new();
    let mut queue = Vec::new();
    doc.trailer
        .iter()
        .for_each(|(_, o)| collect_refs(o, &mut |id| queue.push(id)));
    while let Some(id) = queue.pop() {
        if !seen.insert(id) {
            continue;
        }
        if let Some(object) = doc.objects.get(&id) {
            collect_refs(object, &mut |next| {
                if !seen.contains(&next) {
                    queue.push(next);
                }
            });
        }
    }
    seen
}

fn prune(doc: &mut Document) {
    let keep = reachable(doc);
    doc.objects.retain(|id, _| keep.contains(id));
}
