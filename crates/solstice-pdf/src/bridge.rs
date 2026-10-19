//! The iOS app's way in: a PDF on disk, and requests and answers as JSON
//! (bytes in base64), so the C bridge in the native plugin stays a few
//! lines of strings.

use std::path::Path;

use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use serde::{Deserialize, Serialize};

use crate::{Edit, Insert, Link, Markup, Result};

#[derive(Deserialize)]
struct SaveRequest {
    #[serde(default)]
    inserts: Vec<InsertJson>,
    #[serde(default)]
    edits: Vec<EditJson>,
    /// The pages' final order, after the inserts (`apply_arranged`).
    #[serde(default)]
    order: Option<Vec<usize>>,
}

#[derive(Deserialize)]
struct InsertJson {
    at: usize,
    pdf: String,
}

#[derive(Deserialize)]
struct EditJson {
    page: usize,
    markup: Option<MarkupJson>,
    #[serde(default)]
    absorbed: Vec<String>,
}

#[derive(Deserialize)]
struct MarkupJson {
    data: String,
    #[serde(default)]
    text: String,
    art: Option<String>,
    #[serde(default)]
    links: Vec<LinkJson>,
}

#[derive(Deserialize)]
struct LinkJson {
    rect: [f32; 4],
    url: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Saved {
    hash: String,
    size: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Read {
    pages: Vec<Option<String>>,
    apple: Vec<Vec<AppleInkJson>>,
    needs_repair: bool,
}

#[derive(Serialize)]
struct AppleInkJson {
    fingerprint: String,
    archive: String,
    rect: [f32; 4],
}

fn bytes(base64: &str) -> Result<Vec<u8>> {
    STANDARD.decode(base64).map_err(|e| e.to_string())
}

/// Applies a save request to the PDF at `path` and writes it back.
/// Answers `{hash, size}` of what's now on disk.
pub fn save(path: &Path, request: &str) -> Result<String> {
    let request: SaveRequest = serde_json::from_str(request).map_err(|e| e.to_string())?;
    let inserts = request
        .inserts
        .into_iter()
        .map(|i| {
            Ok(Insert {
                at: i.at,
                pdf: bytes(&i.pdf)?,
            })
        })
        .collect::<Result<Vec<_>>>()?;
    let edits = request
        .edits
        .into_iter()
        .map(|e| {
            let markup = match e.markup {
                Some(m) => Some(Markup {
                    data: bytes(&m.data)?,
                    text: m.text,
                    art: m.art.as_deref().map(bytes).transpose()?,
                    links: m
                        .links
                        .into_iter()
                        .map(|l| Link {
                            rect: l.rect,
                            url: l.url,
                        })
                        .collect(),
                }),
                None => None,
            };
            Ok(Edit {
                page: e.page,
                markup,
                absorbed: e.absorbed,
            })
        })
        .collect::<Result<Vec<_>>>()?;

    let original = std::fs::read(path).map_err(|e| e.to_string())?;
    let written = crate::apply_arranged(&original, &inserts, request.order.as_deref(), &edits)?;
    let hash = crate::write_atomically(path, &written).map_err(|e| e.to_string())?;
    serde_json::to_string(&Saved {
        hash,
        size: written.len(),
    })
    .map_err(|e| e.to_string())
}

/// The marks in the PDF at `path`: `{pages: [base64 | null], apple:
/// [[{fingerprint, archive, rect}]], needsRepair}`.
pub fn read(path: &Path) -> Result<String> {
    let pdf = std::fs::read(path).map_err(|e| e.to_string())?;
    let opened = crate::read(&pdf)?;
    let pages = opened
        .pages
        .iter()
        .map(|p| p.as_deref().map(|b| STANDARD.encode(b)))
        .collect();
    let apple = opened
        .apple
        .into_iter()
        .map(|inks| {
            inks.into_iter()
                .map(|ink| AppleInkJson {
                    fingerprint: ink.fingerprint,
                    archive: STANDARD.encode(ink.archive),
                    rect: ink.rect,
                })
                .collect()
        })
        .collect();
    serde_json::to_string(&Read {
        pages,
        apple,
        needs_repair: opened.needs_repair,
    })
    .map_err(|e| e.to_string())
}
