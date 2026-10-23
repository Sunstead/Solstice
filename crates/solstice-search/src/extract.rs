//! What's searchable in a file.

use serde::{Deserialize, Serialize};

/// The kinds of file whose insides are searched.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "snake_case")]
pub enum Kind {
    /// Markdown, task boards included.
    Note,
    Canvas,
    Drawing,
    Pdf,
}

/// Where in its file a segment's text is.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Place {
    /// A note's whole text.
    Text,
    /// A canvas card, by its id.
    Card { id: String },
    /// A PDF page, zero-based: its own text, or the handwriting on it.
    Page { page: u32, ink: bool },
    /// A drawing's handwriting.
    Handwriting,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Segment {
    pub place: Place,
    pub text: String,
    /// Byte ranges of `text` that aren't searched (a note's comments). Kept
    /// in the text, so every hit's offsets and lines are the file's own.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub skip: Vec<[usize; 2]>,
}

/// A file's searchable text.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Doc {
    pub kind: Kind,
    pub segments: Vec<Segment>,
}

/// The kind of file `name` is, if its insides are searched.
pub fn kind_of(name: &str) -> Option<Kind> {
    let name = name.to_ascii_lowercase();
    if name.ends_with(".md") {
        Some(Kind::Note)
    } else if name.ends_with(".canvas") {
        Some(Kind::Canvas)
    } else if name.ends_with(".drawing.svg") {
        Some(Kind::Drawing)
    } else if name.ends_with(".pdf") {
        Some(Kind::Pdf)
    } else {
        None
    }
}

/// What's searchable in a file of `kind` holding `bytes`. A file that can't
/// be read as its kind has nothing searchable, rather than failing.
pub fn extract(kind: Kind, bytes: &[u8]) -> Doc {
    let segments = match kind {
        Kind::Note => note(&String::from_utf8_lossy(bytes)),
        Kind::Canvas => canvas(bytes),
        Kind::Drawing => drawing(&String::from_utf8_lossy(bytes)),
        Kind::Pdf => pdf(bytes),
    };
    Doc {
        kind,
        segments: segments.into_iter().filter(|s| !s.text.trim().is_empty()).collect(),
    }
}

fn segment(place: Place, text: String) -> Segment {
    Segment { place, text, skip: Vec::new() }
}

fn note(text: &str) -> Vec<Segment> {
    let skip = comment_ranges(text);
    vec![Segment { place: Place::Text, text: text.to_owned(), skip }]
}

/// Text cards, and groups' labels.
fn canvas(bytes: &[u8]) -> Vec<Segment> {
    let Ok(json) = serde_json::from_slice::<serde_json::Value>(bytes) else {
        return Vec::new();
    };
    let Some(nodes) = json.get("nodes").and_then(|n| n.as_array()) else {
        return Vec::new();
    };
    nodes
        .iter()
        .filter_map(|node| {
            let id = node.get("id")?.as_str()?;
            let text = match node.get("type")?.as_str()? {
                "text" => node.get("text"),
                "group" => node.get("label"),
                _ => None,
            }?;
            Some(segment(Place::Card { id: id.to_owned() }, text.as_str()?.to_owned()))
        })
        .collect()
}

/// The handwriting `DrawingFile` writes into `<desc>`.
fn drawing(svg: &str) -> Vec<Segment> {
    let Some(open) = svg.find("<desc") else {
        return Vec::new();
    };
    let Some(start) = svg[open..].find('>').map(|i| open + i + 1) else {
        return Vec::new();
    };
    let Some(end) = svg[start..].find("</desc>").map(|i| start + i) else {
        return Vec::new();
    };
    vec![segment(Place::Handwriting, unescape(&svg[start..end]))]
}

fn unescape(xml: &str) -> String {
    xml.replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&apos;", "'")
        .replace("&amp;", "&")
}

fn pdf(bytes: &[u8]) -> Vec<Segment> {
    let Ok(pages) = solstice_pdf::page_texts(bytes) else {
        return Vec::new();
    };
    pages
        .into_iter()
        .zip(0u32..)
        .flat_map(|(page, n)| {
            [
                segment(Place::Page { page: n, ink: false }, page.text),
                segment(Place::Page { page: n, ink: true }, page.handwriting),
            ]
        })
        .collect()
}

/// The byte ranges of `markdown`'s `%%comments%%`, markers included, by
/// `stripComments`'s rules (`lib/comment/`): none in code, and one left open
/// runs to the next `%%` or the end.
pub fn comment_ranges(markdown: &str) -> Vec<[usize; 2]> {
    const MARKER: &str = "%%";
    let mut ranges = Vec::new();
    if !markdown.contains(MARKER) {
        return ranges;
    }
    // Where the comment we're in began.
    let mut open: Option<usize> = None;
    let mut fence: Option<&str> = None;
    let mut offset = 0;
    for line in markdown.split_inclusive('\n') {
        let start = offset;
        offset += line.len();
        let fence_here = fence_of(line);
        if let Some(current) = fence {
            if fence_here.is_some_and(|f| f.as_bytes()[0] == current.as_bytes()[0] && f.len() >= current.len()) {
                fence = None;
            }
            continue;
        }
        if fence_here.is_some() && open.is_none() {
            fence = fence_here;
            continue;
        }
        let bytes = line.as_bytes();
        let mut i = 0;
        while i < bytes.len() {
            if open.is_none() && bytes[i] == b'`' {
                let ticks = bytes[i..].iter().take_while(|&&b| b == b'`').count();
                let run = &line[i..i + ticks];
                i = match line[i + ticks..].find(run) {
                    Some(close) => i + ticks + close + ticks,
                    None => i + ticks,
                };
                continue;
            }
            if bytes[i..].starts_with(MARKER.as_bytes()) {
                match open.take() {
                    Some(from) => ranges.push([from, start + i + MARKER.len()]),
                    None => open = Some(start + i),
                }
                i += MARKER.len();
                continue;
            }
            i += 1;
        }
    }
    if let Some(from) = open {
        ranges.push([from, markdown.len()]);
    }
    ranges
}

/// The fence a line opens or closes a code block with, if any: up to three
/// spaces, then three or more backticks or tildes.
pub(crate) fn fence_of(line: &str) -> Option<&str> {
    let trimmed = line.trim_start_matches(' ');
    if line.len() - trimmed.len() > 3 {
        return None;
    }
    let first = trimmed.chars().next()?;
    if first != '`' && first != '~' {
        return None;
    }
    let run = trimmed.chars().take_while(|&c| c == first).count();
    (run >= 3).then(|| &trimmed[..run])
}
