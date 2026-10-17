//! Getting files out of the app: PDFs made from notes and drawings, files to
//! hand to the share sheet, and copies saved elsewhere. The frontend builds
//! each PDF's page as standalone HTML (`lib/export/`); this prints it.
//!
//! A computer prints in a hidden window of its own, loaded from the
//! `solstice-export:` scheme (no size limit, no file, no capabilities): the
//! page says when its fonts and pictures are in (`/<id>/ready`), then the
//! Mac writes the PDF (`macos.rs`). Windows and Linux print from the page
//! itself, as the web app does (`lib/backend/print.ts`). The iOS app does all
//! this in Swift (`plugins/native`, `Share.swift`), so these commands only
//! make and fill its temp files there.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;

use base64::Engine;
use serde::Deserialize;
use specta::Type;
use tauri::{AppHandle, Manager};
use tokio::sync::oneshot;

#[cfg(target_os = "macos")]
mod macos;

/// The scheme hidden export windows load their page from.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub const SCHEME: &str = "solstice-export";

/// A page to print on, in points.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
#[derive(Debug, Clone, Copy, Deserialize, Type)]
pub struct PageSpec {
    pub width: f64,
    pub height: f64,
    pub margin: f64,
}

/// Where a share sheet points, in CSS pixels from the webview's top left.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
#[derive(Debug, Clone, Copy, Deserialize, Type)]
pub struct Anchor {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

// ---------------------------------------------------------------- jobs

struct Job {
    html: String,
    ready: Option<oneshot::Sender<()>>,
}

/// Pages being printed, by id, for the `solstice-export:` scheme to serve
/// (only the Mac prints this way).
#[derive(Default)]
pub struct ExportJobs(Mutex<HashMap<String, Job>>);

#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
/// Appended to every page: tells the window it's ready to print, once the
/// fonts are in and every picture has decoded.
const READY_SCRIPT: &str = r#"<script>
Promise.all([document.fonts.ready, ...[...document.images].map((i) => i.decode().catch(() => {}))])
  .finally(() => fetch(location.pathname.replace(/\/$/, '') + '/ready').catch(() => {}));
</script>"#;

#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
impl ExportJobs {
    fn begin(&self, html: String) -> (String, oneshot::Receiver<()>) {
        let id = uuid();
        let (tx, rx) = oneshot::channel();
        self.0.lock().unwrap().insert(id.clone(), Job { html, ready: Some(tx) });
        (id, rx)
    }

    fn end(&self, id: &str) {
        self.0.lock().unwrap().remove(id);
    }

    /// What `/<id>` serves: the page, told to say when it's ready.
    fn page(&self, id: &str) -> Option<String> {
        let jobs = self.0.lock().unwrap();
        let html = &jobs.get(id)?.html;
        Some(match html.rfind("</body>") {
            Some(at) => format!("{}{READY_SCRIPT}{}", &html[..at], &html[at..]),
            None => format!("{html}{READY_SCRIPT}"),
        })
    }

    /// `/<id>/ready`: the page has everything; true the first time.
    fn ready(&self, id: &str) -> bool {
        let sender = self.0.lock().unwrap().get_mut(id).and_then(|job| job.ready.take());
        sender.is_some_and(|tx| tx.send(()).is_ok())
    }

    /// Answers a request on the scheme.
    pub fn serve(&self, path: &str) -> tauri::http::Response<Vec<u8>> {
        let path = path.trim_matches('/');
        let respond = |status: u16, kind: &str, body: Vec<u8>| {
            tauri::http::Response::builder()
                .status(status)
                .header("Content-Type", kind)
                .body(body)
                .expect("a valid response")
        };
        match path.split_once('/') {
            Some((id, "ready")) => respond(if self.ready(id) { 204 } else { 404 }, "text/plain", Vec::new()),
            None => match self.page(path) {
                Some(html) => respond(200, "text/html; charset=utf-8", html.into_bytes()),
                None => respond(404, "text/plain", Vec::new()),
            },
            _ => respond(404, "text/plain", Vec::new()),
        }
    }
}

fn uuid() -> String {
    let mut bytes = [0u8; 16];
    getrandom::fill(&mut bytes).expect("the OS random number generator failed");
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

// ---------------------------------------------------------------- temp files

/// Made-to-share files live here until the app next starts.
fn share_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app.path().app_cache_dir().map_err(|e| e.to_string())?.join("share"))
}

/// Last session's shared files: whatever took them has its own copy by now.
pub fn clear_share_dir(app: &AppHandle) {
    if let Ok(dir) = share_dir(app) {
        let _ = std::fs::remove_dir_all(dir);
    }
}

/// A file name as given, minus what would make it a path.
fn file_name(name: &str) -> String {
    let clean: String = name
        .chars()
        .map(|c| if matches!(c, '/' | '\\' | ':') || c.is_control() { '-' } else { c })
        .collect();
    let clean = clean.trim().trim_start_matches('.').to_owned();
    if clean.is_empty() { "Untitled".into() } else { clean }
}

/// `<cache>/share/<random>/<name>`: its own folder, so the file keeps its
/// name (the share sheet shows it) without colliding.
fn fresh_path(app: &AppHandle, name: &str) -> Result<PathBuf, String> {
    let dir = share_dir(app)?.join(uuid());
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join(file_name(name)))
}

/// Where to write a file made to share, such as a PDF.
#[tauri::command]
#[specta::specta]
pub fn export_temp_path(app: AppHandle, name: String) -> Result<String, String> {
    Ok(fresh_path(&app, &name)?.to_string_lossy().into_owned())
}

/// Writes a file made to share (a drawing's PNG), and says where.
#[tauri::command]
#[specta::specta]
pub fn write_export_file(app: AppHandle, name: String, base64: String) -> Result<String, String> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(base64)
        .map_err(|e| e.to_string())?;
    let path = fresh_path(&app, &name)?;
    std::fs::write(&path, bytes).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().into_owned())
}

// ---------------------------------------------------------------- PDFs

/// Prints `html` to a PDF at `out_path`, on pages of `page` (macOS).
#[tauri::command]
#[specta::specta]
pub async fn render_pdf(app: AppHandle, html: String, page: PageSpec, out_path: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let jobs = app.state::<ExportJobs>();
        let (id, ready) = jobs.begin(html);
        let result = print_job(&app, &id, ready, page, PathBuf::from(out_path)).await;
        jobs.end(&id);
        result
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, html, page, out_path);
        Err("PDFs aren't written directly here.".into())
    }
}

#[cfg(target_os = "macos")]
async fn print_job(
    app: &AppHandle,
    id: &str,
    ready: oneshot::Receiver<()>,
    page: PageSpec,
    out: PathBuf,
) -> Result<(), String> {
    let url = format!("{SCHEME}://localhost/{id}");
    let window = tauri::WebviewWindowBuilder::new(
        app,
        format!("export-{id}"),
        tauri::WebviewUrl::CustomProtocol(url.parse().map_err(|e: url::ParseError| e.to_string())?),
    )
    .title("Export")
    .visible(false)
    .inner_size(page.width, page.height)
    .build()
    .map_err(|e| e.to_string())?;

    let printed = async {
        tokio::time::timeout(std::time::Duration::from_secs(30), ready)
            .await
            .map_err(|_| "The page took too long to load.".to_string())?
            .map_err(|_| "The page was closed.".to_string())?;
        print_window(&window, page, out).await
    }
    .await;
    let _ = window.destroy();
    printed
}

#[cfg(target_os = "macos")]
async fn print_window(window: &tauri::WebviewWindow, page: PageSpec, out: PathBuf) -> Result<(), String> {
    let (tx, rx) = oneshot::channel();
    window
        .with_webview(move |webview| macos::print_to_pdf(webview.inner(), webview.ns_window(), page, &out, tx))
        .map_err(|e| e.to_string())?;
    rx.await.map_err(|_| "Printing stopped.".to_string())?
}

// ---------------------------------------------------------------- sharing

/// The system's share picker for `paths`, pointing at `anchor` (macOS; the
/// iPad's is the native plugin's).
#[tauri::command]
#[specta::specta]
pub fn share_files(window: tauri::WebviewWindow, paths: Vec<String>, anchor: Option<Anchor>) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        window
            .with_webview(move |webview| macos::share(webview.inner(), &paths, anchor))
            .map_err(|e| e.to_string())
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (window, paths, anchor);
        Err("There's no share sheet here.".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn text(res: tauri::http::Response<Vec<u8>>) -> (u16, String) {
        (res.status().as_u16(), String::from_utf8(res.into_body()).unwrap())
    }

    #[test]
    fn a_job_is_served_with_the_ready_script_before_its_body_ends() {
        let jobs = ExportJobs::default();
        let (id, _ready) = jobs.begin("<html><body><p>Hi</p></body></html>".into());
        let (status, page) = text(jobs.serve(&format!("/{id}")));
        assert_eq!(status, 200);
        assert!(page.starts_with("<html><body><p>Hi</p><script>"), "{page}");
        assert!(page.ends_with("</script></body></html>"));
        assert_eq!(text(jobs.serve("/nothing")).0, 404);
    }

    #[tokio::test]
    async fn ready_wakes_the_print_once() {
        let jobs = ExportJobs::default();
        let (id, ready) = jobs.begin("<p>x</p>".into());
        assert_eq!(text(jobs.serve(&format!("/{id}/ready"))).0, 204);
        ready.await.unwrap();
        assert_eq!(text(jobs.serve(&format!("/{id}/ready"))).0, 404);
        jobs.end(&id);
        assert_eq!(text(jobs.serve(&format!("/{id}"))).0, 404);
    }

    #[test]
    fn a_shared_file_keeps_its_name_but_never_a_path() {
        assert_eq!(file_name("Plan.pdf"), "Plan.pdf");
        assert_eq!(file_name("../../etc/passwd"), "-..-etc-passwd");
        assert_eq!(file_name("a:b\\c"), "a-b-c");
        assert_eq!(file_name("  "), "Untitled");
        assert_eq!(file_name(".hidden"), "hidden");
    }
}
