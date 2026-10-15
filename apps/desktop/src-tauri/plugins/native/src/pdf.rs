//! The PDF writer (`solstice-pdf`) for the Swift side (`PdfStore.swift`),
//! which calls these directly: a path and a JSON request in, a JSON answer
//! out (`{"error": ...}` when it failed), freed with `solstice_pdf_free`.
//! Megabytes of markup never go through the webview this way.

use std::ffi::{c_char, CStr, CString};
use std::path::Path;

fn answer(work: impl FnOnce() -> Result<String, String> + std::panic::UnwindSafe) -> *mut c_char {
    let json = match std::panic::catch_unwind(work) {
        Ok(Ok(json)) => json,
        Ok(Err(e)) => serde_json::json!({ "error": e }).to_string(),
        Err(_) => serde_json::json!({ "error": "The PDF writer failed." }).to_string(),
    };
    CString::new(json).unwrap_or_default().into_raw()
}

/// # Safety
/// `text` is a NUL-terminated string that lives through the call.
unsafe fn string<'a>(text: *const c_char) -> Result<&'a str, String> {
    if text.is_null() {
        return Err("Nothing was passed.".into());
    }
    CStr::from_ptr(text).to_str().map_err(|e| e.to_string())
}

/// The marks in the PDF at `path`: `{pages, needsRepair}`.
///
/// # Safety
/// `path` is a NUL-terminated UTF-8 string.
#[no_mangle]
pub unsafe extern "C" fn solstice_pdf_read(path: *const c_char) -> *mut c_char {
    let path = string(path);
    answer(move || solstice_pdf::bridge::read(Path::new(path?)))
}

/// Applies `request` to the PDF at `path` and writes it: `{hash, size}`.
///
/// # Safety
/// `path` and `request` are NUL-terminated UTF-8 strings.
#[no_mangle]
pub unsafe extern "C" fn solstice_pdf_save(
    path: *const c_char,
    request: *const c_char,
) -> *mut c_char {
    let (path, request) = (string(path), string(request));
    answer(move || solstice_pdf::bridge::save(Path::new(path?), request?))
}

/// Frees an answer.
///
/// # Safety
/// `answer` came from one of the functions above, and is freed once.
#[no_mangle]
pub unsafe extern "C" fn solstice_pdf_free(answer: *mut c_char) {
    if !answer.is_null() {
        drop(CString::from_raw(answer));
    }
}
