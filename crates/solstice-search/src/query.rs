//! Finding a string in extracted docs.

use serde::{Deserialize, Serialize};

use crate::extract::{fence_of, Doc, Kind, Place, Segment};

/// What to look for: a literal string, with the find bar's two options.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct Query {
    pub text: String,
    pub case_sensitive: bool,
    pub whole_word: bool,
}

/// How many hits come back.
#[derive(Debug, Clone, Copy)]
pub struct Limits {
    /// In all.
    pub max_hits: usize,
    /// Per file; the rest are only counted.
    pub per_file: usize,
}

impl Default for Limits {
    fn default() -> Self {
        Self { max_hits: 2000, per_file: 100 }
    }
}

/// Where a hit is, as its file's view goes there.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Jump {
    /// In a note's text, zero-based, the column in UTF-16 units. `ordinal`
    /// is the hit's index among the rich editor's find matches (which see
    /// comments but not front matter or link destinations), or `None` when
    /// the hit is where the rich editor has no text.
    Line { line: u32, column: u32, ordinal: Option<u32> },
    /// A canvas card.
    Card { id: String },
    /// A PDF page, zero-based.
    Page { page: u32, ink: bool },
    /// A drawing's handwriting.
    Handwriting,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct Hit {
    /// The hit's line, cut down around it.
    pub preview: String,
    /// The hit in `preview`, `[start, end)` in UTF-16 units.
    pub range: [u32; 2],
    pub jump: Jump,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct FileHits {
    /// As the caller named the file.
    pub path: String,
    pub kind: Kind,
    /// Every hit in the file, including those not in `hits`.
    pub count: u32,
    pub hits: Vec<Hit>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct Results {
    /// Most hits first, then by path.
    pub files: Vec<FileHits>,
    /// Every hit in every file.
    pub total: u32,
    /// Some hits were left out for `Limits`.
    pub truncated: bool,
}

/// Characters either side of a hit in its preview.
const CONTEXT: usize = 40;

/// `query` in each of `docs`, named by their path.
pub fn search<'a>(
    docs: impl IntoIterator<Item = (&'a str, &'a Doc)>,
    query: &Query,
    limits: Limits,
) -> Results {
    if query.text.is_empty() {
        return Results::default();
    }
    let needle = if query.case_sensitive { query.text.clone() } else { fold(&query.text) };

    let mut found: Vec<(&str, &Doc, Vec<Found>)> = docs
        .into_iter()
        .filter_map(|(path, doc)| {
            let hits: Vec<Found> = doc
                .segments
                .iter()
                .enumerate()
                .flat_map(|(index, segment)| in_segment(doc.kind, index, segment, &needle, query))
                .collect();
            (!hits.is_empty()).then_some((path, doc, hits))
        })
        .collect();
    found.sort_by(|a, b| b.2.len().cmp(&a.2.len()).then_with(|| a.0.cmp(b.0)));

    let mut results = Results::default();
    let mut budget = limits.max_hits;
    for (path, doc, hits) in found {
        let count = hits.len() as u32;
        let take = hits.len().min(limits.per_file).min(budget);
        budget -= take;
        results.truncated |= take < hits.len();
        results.total += count;
        results.files.push(FileHits {
            path: path.to_owned(),
            kind: doc.kind,
            count,
            hits: hits.into_iter().take(take).map(|f| hit(&doc.segments[f.segment], &f)).collect(),
        });
    }
    results
}

/// A hit before it's dressed: where it is in its segment.
struct Found {
    segment: usize,
    start: usize,
    end: usize,
    ordinal: Option<u32>,
}

fn in_segment(kind: Kind, index: usize, segment: &Segment, needle: &str, query: &Query) -> Vec<Found> {
    let text = &segment.text;
    let haystack = if query.case_sensitive { std::borrow::Cow::Borrowed(text.as_str()) } else { fold(text).into() };
    let all = matches(&haystack, text, needle, query.whole_word);
    let outside = |ranges: &[[usize; 2]], (start, end): (usize, usize)| {
        !ranges.iter().any(|&[from, to]| start < to && end > from)
    };

    // The rich editor's own find counts matches in comments, but has no text
    // for front matter, link destinations or code blocks.
    let hidden = (kind == Kind::Note && segment.place == Place::Text).then(|| hidden_from_editor(text));
    let mut ordinal = 0;
    let mut found = Vec::new();
    for range in all {
        let seen = hidden.as_ref().map(|h| outside(h, range));
        if outside(&segment.skip, range) {
            found.push(Found {
                segment: index,
                start: range.0,
                end: range.1,
                ordinal: seen.filter(|&s| s).map(|_| ordinal),
            });
        }
        if seen == Some(true) {
            ordinal += 1;
        }
    }
    found
}

/// Every match of `needle` in `haystack` (`text`, folded or not: the same
/// offsets), overlapping ones included and none across a line, as the find
/// bar counts them (`searchFlat` in `lib/find/matches.ts`).
fn matches(haystack: &str, text: &str, needle: &str, whole_word: bool) -> Vec<(usize, usize)> {
    let mut found = Vec::new();
    if needle.contains('\n') {
        return found;
    }
    let mut from = 0;
    while let Some(at) = haystack[from..].find(needle) {
        let start = from + at;
        let end = start + needle.len();
        let bounded = !whole_word
            || (!text[..start].chars().next_back().is_some_and(is_word)
                && !text[end..].chars().next().is_some_and(is_word));
        if bounded {
            found.push((start, end));
        }
        from = start + haystack[start..].chars().next().map_or(1, char::len_utf8);
    }
    found
}

/// A word character for whole-word purposes: letters and digits of any
/// script, and `_` (the find bar's `[\p{L}\p{N}_]`).
fn is_word(c: char) -> bool {
    c.is_alphanumeric() || c == '_'
}

/// `text` lowercased one character for one, so its offsets stay the
/// original's: a character whose lowercase is longer, or more than one
/// character, stays as it is.
fn fold(text: &str) -> String {
    if text.is_ascii() {
        return text.to_ascii_lowercase();
    }
    text.chars()
        .map(|c| {
            let mut lower = c.to_lowercase();
            match (lower.next(), lower.next()) {
                (Some(l), None) if l.len_utf8() == c.len_utf8() => l,
                _ => c,
            }
        })
        .collect()
}

/// The byte ranges of a note the rich editor has no text for: front matter,
/// fenced code blocks and link destinations.
fn hidden_from_editor(text: &str) -> Vec<[usize; 2]> {
    let mut ranges = Vec::new();
    let (front, body) = solstice_core::split_front_matter(text);
    let body_start = if front.is_some() { text.len() - body.len() } else { 0 };
    if body_start > 0 {
        ranges.push([0, body_start]);
    }

    let mut fence: Option<(usize, &str)> = None;
    let mut offset = body_start;
    for line in body.split_inclusive('\n') {
        let start = offset;
        offset += line.len();
        let here = fence_of(line);
        match fence {
            Some((from, open)) => {
                if here.is_some_and(|f| f.as_bytes()[0] == open.as_bytes()[0] && f.len() >= open.len()) {
                    ranges.push([from, offset]);
                    fence = None;
                }
            }
            None if here.is_some() => fence = here.map(|f| (start, f)),
            None => {
                let mut at = 0;
                while let Some(open) = line[at..].find("](") {
                    let paren = at + open + 1;
                    let Some(close) = line[paren..].find(')') else { break };
                    ranges.push([start + paren, start + paren + close + 1]);
                    at = paren + close + 1;
                }
            }
        }
    }
    if let Some((from, _)) = fence {
        ranges.push([from, text.len()]);
    }
    ranges
}

fn hit(segment: &Segment, found: &Found) -> Hit {
    let text = &segment.text;
    let line_start = text[..found.start].rfind('\n').map_or(0, |i| i + 1);
    let line_end = text[found.end..].find('\n').map_or(text.len(), |i| found.end + i);

    let before = &text[line_start..found.start];
    let after = &text[found.end..line_end];
    let before = match before.char_indices().rev().nth(CONTEXT - 1) {
        Some((cut, _)) if cut > 0 => format!("…{}", &before[cut..]),
        _ => before.trim_start().to_owned(),
    };
    let after = match after.char_indices().nth(CONTEXT) {
        Some((cut, _)) => format!("{}…", &after[..cut]),
        None => after.trim_end().to_owned(),
    };
    let start = utf16_len(&before);
    let end = start + utf16_len(&text[found.start..found.end]);
    let preview = format!("{before}{}{after}", &text[found.start..found.end]);

    let jump = match &segment.place {
        Place::Text => Jump::Line {
            line: text[..found.start].matches('\n').count() as u32,
            column: utf16_len(&text[line_start..found.start]),
            ordinal: found.ordinal,
        },
        Place::Card { id } => Jump::Card { id: id.clone() },
        Place::Page { page, ink } => Jump::Page { page: *page, ink: *ink },
        Place::Handwriting => Jump::Handwriting,
    };
    Hit { preview, range: [start, end], jump }
}

fn utf16_len(text: &str) -> u32 {
    text.encode_utf16().count() as u32
}
