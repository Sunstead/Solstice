//! The app's windows: full windows (one per workspace) and editor windows
//! (tabs torn off a full window, same workspace, no explorer). Which are open
//! and where is kept in `windows.json`, so a relaunch reopens them all.

mod session;

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::json;
use specta::Type;
#[allow(unused_imports)]
use tauri::{AppHandle, EventTarget, Runtime, LogicalPosition, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use tauri::utils::config::WindowConfig;
use tauri_plugin_store::StoreExt;
use tauri_specta::Event;

pub use session::{menu_target, window_under, DragSlot, Bounds, Session, WindowEntry, WindowKind};

const STORE: &str = "windows.json";
const KEY: &str = "session";
/// The first window's label, as it always was.
pub const MAIN: &str = "main";

/// A flush waiting on other windows: how many are left, and who's waiting.
type Flush = (usize, Option<tokio::sync::oneshot::Sender<()>>);

#[derive(Default)]
pub struct WindowsState {
    session: Mutex<Session>,
    focused: Mutex<Option<String>>,
    /// A torn-off tab waiting for its new window to ask for it.
    tabs: Mutex<HashMap<String, String>>,
    flushes: Mutex<HashMap<u32, Flush>>,
    drag: Mutex<DragSlot>,
}

/// What a window shows when it starts.
#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct WindowInit {
    pub label: String,
    pub kind: WindowKind,
    pub workspace: Option<String>,
    /// A tab torn off another window, as flexlayout tab JSON.
    pub tab: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, Type)]
pub struct Point {
    pub x: f64,
    pub y: f64,
}

#[derive(Debug, Clone, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct OpenWindow {
    /// An editor window of the calling window's workspace, else a full one.
    pub editor: bool,
    pub workspace: Option<String>,
    pub tab: Option<String>,
    /// Where on the screen the pointer let go of a torn-off tab.
    pub at: Option<Point>,
}

/// A tab dragged out of this window landed in another: take it out here.
#[derive(Debug, Clone, Serialize, Deserialize, Type, Event)]
#[serde(rename_all = "camelCase")]
pub struct TabAdopted {
    pub tab_id: String,
}

/// A tab is being dragged out of another window (its payload), or no
/// longer is (`None`): a drag carries nothing another window can read
/// before the drop, so it's told here.
#[derive(Debug, Clone, Serialize, Deserialize, Type, Event)]
pub struct TabDrag {
    pub payload: Option<String>,
}

/// A tab sent here from another window's tab menu (`TabPayload` JSON).
#[derive(Debug, Clone, Serialize, Deserialize, Type, Event)]
pub struct TabSent {
    pub payload: String,
}

/// A window opened, closed or changed workspace.
#[derive(Debug, Clone, Serialize, Deserialize, Type, Event)]
pub struct WindowsChanged;

/// Another window wrote a settings file; read it again.
#[derive(Debug, Clone, Serialize, Deserialize, Type, Event)]
pub struct StoreChanged {
    pub file: String,
}

/// Save every open editor now, then say so (`windows_flushed`).
#[derive(Debug, Clone, Serialize, Deserialize, Type, Event)]
pub struct FlushRequested {
    pub id: u32,
}

fn random_label() -> String {
    let mut bytes = [0u8; 8];
    getrandom::fill(&mut bytes).expect("the OS random number generator failed");
    let hex: String = bytes.iter().map(|b| format!("{b:02x}")).collect();
    format!("w-{hex}")
}

/// An editor window's layout, beside the full window's `layout.json`
/// (`layoutFileFor` on the frontend).
fn editor_layout_file(label: &str) -> String {
    format!("layout-{label}.json")
}

fn save(app: &AppHandle, session: &Session) {
    if let Ok(store) = app.store(STORE) {
        store.set(KEY, json!(session));
    }
}

/// The windows the session knows of that are open now, oldest first.
fn open_labels<R: Runtime>(app: &AppHandle<R>) -> Vec<String> {
    let open = app.webview_windows();
    let session = app.state::<WindowsState>().session.lock().unwrap().clone();
    session.windows.into_iter().map(|w| w.label).filter(|l| open.contains_key(l)).collect()
}

/// The window menu commands and a second launch go to.
pub fn current<R: Runtime>(app: &AppHandle<R>) -> Option<WebviewWindow<R>> {
    let labels = open_labels(app);
    let refs: Vec<&str> = labels.iter().map(String::as_str).collect();
    let focused = app.state::<WindowsState>().focused.lock().unwrap().clone();
    menu_target(focused.as_deref(), &refs).and_then(|l| app.get_webview_window(l))
}

fn bounds_of(window: &tauri::Window) -> Option<Bounds> {
    let scale = window.scale_factor().ok()?;
    let at = window.outer_position().ok()?.to_logical::<f64>(scale);
    let size = window.inner_size().ok()?.to_logical::<f64>(scale);
    Some(Bounds { x: at.x, y: at.y, width: size.width, height: size.height })
}

fn build(app: &AppHandle, label: &str, bounds: Option<Bounds>) -> tauri::Result<WebviewWindow> {
    let config = WindowConfig {
        label: label.into(),
        url: WebviewUrl::default(),
        drag_drop_enabled: false,
        ..Default::default()
    };
    let builder = WebviewWindowBuilder::from_config(app, &config)?;

    // A phone's window is the screen; these are a computer's.
    #[cfg(desktop)]
    let builder = {
        let b = builder
            .title("Solstice")
            // Narrow windows get the phone layout; below this it can't help.
            .min_inner_size(400.0, 500.0);
        match bounds {
            Some(r) => b.inner_size(r.width, r.height).position(r.x, r.y),
            None => b.inner_size(1200.0, 800.0),
        }
    };
    #[cfg(not(desktop))]
    let _ = bounds;

    #[cfg(target_os = "macos")]
    let builder = {
        use tauri::TitleBarStyle;
        builder
            .title_bar_style(TitleBarStyle::Overlay)
            .hidden_title(true)
            .traffic_light_position(LogicalPosition::new(16.0, 22.0))
    };

    #[cfg(all(desktop, not(target_os = "macos")))]
    let builder = builder.decorations(false);

    builder.build()
}

/// Opens the windows open when the app last quit, or one full window.
pub fn restore(app: &AppHandle) -> tauri::Result<()> {
    let saved: Session = app
        .store(STORE)
        .ok()
        .and_then(|s| s.get(KEY))
        .and_then(|v| serde_json::from_value(v).ok())
        .unwrap_or_default();
    // A phone has one window.
    let mut windows = if cfg!(desktop) { saved.restorable() } else { Vec::new() };
    if windows.is_empty() {
        windows.push(WindowEntry { label: MAIN.into(), kind: WindowKind::Full, workspace: None, bounds: None });
    }
    {
        let state = app.state::<WindowsState>();
        let mut session = state.session.lock().unwrap();
        *session = Session { windows: windows.clone(), quitting: false };
        save(app, &session);
    }
    for w in windows {
        build(app, &w.label, w.bounds)?;
    }
    Ok(())
}

/// The workspace a window shows changed (`set_workspace`).
pub fn workspace_set(app: &AppHandle, label: &str, workspace: &str) {
    {
        let state = app.state::<WindowsState>();
        let mut session = state.session.lock().unwrap();
        session.set_workspace(label, Some(workspace.into()));
        save(app, &session);
    }
    WindowsChanged.emit(app).ok();
}

/// The app is quitting: the windows closing now come back next launch.
pub fn quitting(app: &AppHandle) {
    let state = app.state::<WindowsState>();
    let mut session = state.session.lock().unwrap();
    session.quitting = true;
    save(app, &session);
    if let Ok(store) = app.store(STORE) {
        let _ = store.save();
    }
}

pub fn on_window_event(window: &tauri::Window, event: &tauri::WindowEvent) {
    let app = window.app_handle();
    let state = app.state::<WindowsState>();
    let label = window.label();
    match event {
        tauri::WindowEvent::Focused(true) => {
            *state.focused.lock().unwrap() = Some(label.into());
        }
        tauri::WindowEvent::Moved(_) | tauri::WindowEvent::Resized(_) => {
            if let Some(bounds) = bounds_of(window) {
                let mut session = state.session.lock().unwrap();
                if session.get(label).is_some() {
                    session.set_bounds(label, bounds);
                    save(app, &session);
                }
            }
        }
        tauri::WindowEvent::CloseRequested { .. } => {
            log::info!("window {label}: close requested");
            let editors = {
                let mut session = state.session.lock().unwrap();
                // Set before its editor windows go, so they're kept with it.
                if session.is_last_full(label) {
                    session.quitting = true;
                }
                session.editors_of(label)
            };
            // Each flushes its editors as it closes (the frontend's
            // close handler), then goes.
            for editor in editors {
                if let Some(w) = app.get_webview_window(&editor) {
                    let _ = w.close();
                }
            }
        }
        tauri::WindowEvent::Destroyed => {
            log::info!("window {label}: destroyed");
            let (changed, entry) = {
                let mut session = state.session.lock().unwrap();
                let entry = session.get(label).cloned();
                let changed = session.close(label);
                save(app, &session);
                (changed, entry)
            };
            // An editor window put away for good takes its layout with it.
            if let Some(WindowEntry { kind: WindowKind::Editor { .. }, workspace: Some(ws), .. }) = entry.filter(|_| changed) {
                let _ = std::fs::remove_file(std::path::Path::new(&ws).join(".solstice").join(editor_layout_file(label)));
            }
            state.tabs.lock().unwrap().remove(label);
            if changed {
                WindowsChanged.emit(app).ok();
            }
        }
        _ => {}
    }
}

#[tauri::command]
#[specta::specta]
pub fn get_window_init(window: tauri::Window, state: tauri::State<WindowsState>) -> WindowInit {
    let label = window.label().to_string();
    let entry = state.session.lock().unwrap().get(&label).cloned();
    let tab = state.tabs.lock().unwrap().remove(&label);
    log::info!("window {label}: init {:?}, workspace {:?}, tab {}", entry.as_ref().map(|e| &e.kind), entry.as_ref().and_then(|e| e.workspace.as_deref()), tab.is_some());
    WindowInit {
        kind: entry.as_ref().map_or(WindowKind::Full, |e| e.kind.clone()),
        workspace: entry.and_then(|e| e.workspace),
        tab,
        label,
    }
}

#[tauri::command]
#[specta::specta]
pub fn list_windows(state: tauri::State<WindowsState>) -> Vec<WindowEntry> {
    state.session.lock().unwrap().windows.clone()
}

/// Opens a window, and returns its label. A full window of a workspace that
/// already has one brings that one forward instead.
#[tauri::command]
#[specta::specta]
pub fn open_window(
    app: AppHandle,
    window: tauri::Window,
    state: tauri::State<WindowsState>,
    request: OpenWindow,
) -> Result<String, String> {
    let label = random_label();
    {
        let mut session = state.session.lock().unwrap();
        if !request.editor {
            if let Some(existing) = request.workspace.as_deref().and_then(|ws| session.full_window_for(ws)) {
                let existing = existing.to_string();
                drop(session);
                focus(&app, &existing);
                return Ok(existing);
            }
        }
        let kind = if request.editor {
            WindowKind::Editor { parent: session.owner(window.label()).to_string() }
        } else {
            WindowKind::Full
        };
        // The new window's tab strip under the pointer, as a dragged-out
        // tab lands in VS Code.
        let bounds = request.at.map(|p| Bounds { x: p.x - 120.0, y: p.y - 20.0, width: 900.0, height: 700.0 });
        session.add(WindowEntry { label: label.clone(), kind, workspace: request.workspace, bounds });
        save(&app, &session);
    }
    if let Some(tab) = request.tab {
        state.tabs.lock().unwrap().insert(label.clone(), tab);
    }

    log::info!("window {label}: opening, from {}, editor {}", window.label(), request.editor);
    // Not under the lock: building sends this window events of its own.
    let bounds = state.session.lock().unwrap().get(&label).and_then(|w| w.bounds);
    if let Err(e) = build(&app, &label, bounds) {
        log::error!("window {label}: couldn't open: {e}");
        state.session.lock().unwrap().windows.retain(|w| w.label != label);
        state.tabs.lock().unwrap().remove(&label);
        return Err(e.to_string());
    }
    WindowsChanged.emit(&app).ok();
    Ok(label)
}

fn focus(app: &AppHandle, label: &str) {
    if let Some(w) = app.get_webview_window(label) {
        #[cfg(desktop)]
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

#[tauri::command]
#[specta::specta]
pub fn focus_window(app: AppHandle, label: String) {
    focus(&app, &label);
}

/// Brings forward the full window showing `workspace`, if it isn't this one.
/// Returns whether there was one.
#[tauri::command]
#[specta::specta]
pub fn focus_full_window_for(
    app: AppHandle,
    window: tauri::Window,
    state: tauri::State<WindowsState>,
    workspace: String,
) -> bool {
    let found = state.session.lock().unwrap().full_window_for(&workspace).map(str::to_string);
    match found {
        Some(label) if label != window.label() => {
            focus(&app, &label);
            true
        }
        _ => false,
    }
}

/// Where the pointer is as a tab drag ends: on the screen (logical pixels,
/// for placing a new window), whether it's over the window the tab left, and
/// which other window it's over. Asked of the OS rather than the drag's own
/// event, whose coordinates WebKit doesn't keep at the end of a drag.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct PointerSpot {
    pub at: Point,
    pub inside: bool,
    pub over: Option<String>,
}

/// A tab drag out of this window ended where the OS saw the button come up
/// (WebKit doesn't always send `dragend` when it ends over another app).
#[derive(Debug, Clone, Serialize, Deserialize, Type, Event)]
pub struct TabDragEnded {
    pub spot: PointerSpot,
}

/// Whether the primary button is down; unknown on Linux, where a tab drag
/// ends only with the page's own `dragend`.
fn primary_button_down() -> Option<bool> {
    #[cfg(target_os = "macos")]
    return Some(objc2_app_kit::NSEvent::pressedMouseButtons() & 1 != 0);
    #[cfg(windows)]
    {
        use windows_sys::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, VK_LBUTTON};
        // SAFETY: reads global key state, no pointers involved.
        return Some(unsafe { GetAsyncKeyState(VK_LBUTTON as i32) } < 0);
    }
    #[allow(unreachable_code)]
    None
}

fn frame<R: Runtime>(w: &WebviewWindow<R>) -> Option<Bounds> {
    let at = w.outer_position().ok()?;
    let size = w.outer_size().ok()?;
    Some(Bounds { x: at.x as f64, y: at.y as f64, width: size.width as f64, height: size.height as f64 })
}

fn pointer_spot<R: Runtime>(app: &AppHandle<R>, source: &str) -> Option<PointerSpot> {
    let cursor = app.cursor_position().ok()?;
    let state = app.state::<WindowsState>();
    let labels: Vec<String> = state.session.lock().unwrap().windows.iter().map(|w| w.label.clone()).collect();
    let focused = state.focused.lock().unwrap().clone();
    // Frames in physical pixels, as the cursor is; the focused window first,
    // as it's the one in front.
    let mut frames: Vec<(String, Bounds)> = labels
        .into_iter()
        .filter_map(|l| app.get_webview_window(&l).and_then(|w| frame(&w)).map(|b| (l, b)))
        .collect();
    frames.sort_by_key(|(l, _)| Some(l) != focused.as_ref());
    let inside = frames.iter().any(|(l, b)| l == source && b.contains(cursor.x, cursor.y));
    let others: Vec<_> = frames.into_iter().filter(|(l, _)| l != source).collect();
    let over = window_under(&others, cursor.x, cursor.y).map(str::to_string);
    let scale = app.get_webview_window(source).and_then(|w| w.scale_factor().ok()).unwrap_or(1.0);
    Some(PointerSpot { at: Point { x: cursor.x / scale, y: cursor.y / scale }, inside, over })
}

/// How often a tab drag looks at the button, and how long a drop on another
/// window gets to land before the windows stand down.
const WATCH: Duration = Duration::from_millis(30);
const SETTLE: Duration = Duration::from_millis(300);

/// The drag `source` started is over: where it ended, and the other windows
/// told, once a drop on one of them has had time to land.
fn finish_drag<R: Runtime>(app: &AppHandle<R>, source: &str) -> Option<PointerSpot> {
    let spot = pointer_spot(app, source);
    let app = app.clone();
    let source = source.to_string();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(SETTLE).await;
        TabDrag { payload: None }.emit_filter(&app, others(&source)).ok();
    });
    spot
}

/// A tab drag leaves this window: the other windows are told what's coming
/// (a drag carries nothing they can read before the drop), and the button is
/// watched, so the drag ends even when WebKit sends no `dragend`.
#[tauri::command]
#[specta::specta]
pub fn begin_tab_drag(app: AppHandle, window: tauri::Window, state: tauri::State<WindowsState>, payload: String) {
    let source = window.label().to_string();
    let id = state.drag.lock().unwrap().begin(&source);
    TabDrag { payload: Some(payload) }.emit_filter(&app, others(&source)).ok();
    if primary_button_down().is_none() {
        return;
    }
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(WATCH).await;
            let state = app.state::<WindowsState>();
            if !state.drag.lock().unwrap().is(id) {
                return;
            }
            if primary_button_down() == Some(false) {
                let ended = state.drag.lock().unwrap().end(id);
                if let Some(spot) = ended.and_then(|source| finish_drag(&app, &source)) {
                    TabDragEnded { spot }.emit_to(&app, source.as_str()).ok();
                }
                return;
            }
        }
    });
}

/// The page saw its tab drag end (`dragend`). Where it ended, unless the
/// button watch already said so.
#[tauri::command]
#[specta::specta]
pub fn end_tab_drag(app: AppHandle, window: tauri::Window, state: tauri::State<WindowsState>) -> Option<PointerSpot> {
    let ended = state.drag.lock().unwrap().end_from(window.label());
    ended.and_then(|_| finish_drag(&app, window.label()))
}

/// Tells `source` its tab landed here, so it lets it go.
#[tauri::command]
#[specta::specta]
pub fn tab_adopted(app: AppHandle, source: String, tab_id: String) -> Result<(), String> {
    TabAdopted { tab_id }.emit_to(&app, source.as_str()).map_err(|e| e.to_string())
}

fn others(me: &str) -> impl Fn(&EventTarget) -> bool + '_ {
    move |target| match target {
        EventTarget::Window { label } | EventTarget::Webview { label } | EventTarget::WebviewWindow { label } => {
            label != me
        }
        _ => false,
    }
}

/// Sends a tab to another window (Move to Window), and brings it forward.
#[tauri::command]
#[specta::specta]
pub fn send_tab(app: AppHandle, target: String, payload: String) -> Result<(), String> {
    TabSent { payload }.emit_to(&app, target.as_str()).map_err(|e| e.to_string())?;
    focus(&app, &target);
    Ok(())
}

/// Tells every other window a settings file changed.
#[tauri::command]
#[specta::specta]
pub fn store_changed(app: AppHandle, window: tauri::Window, file: String) {
    StoreChanged { file }.emit_filter(&app, others(window.label())).ok();
}

/// Has every other window save its editors, waiting up to a few seconds.
#[tauri::command]
#[specta::specta]
pub async fn flush_other_windows(app: AppHandle, window: tauri::Window) -> Result<(), String> {
    let others_open = open_labels(&app).into_iter().filter(|l| l != window.label()).count();
    if others_open == 0 {
        return Ok(());
    }
    let mut id_bytes = [0u8; 4];
    getrandom::fill(&mut id_bytes).map_err(|e| e.to_string())?;
    let id = u32::from_le_bytes(id_bytes);
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.state::<WindowsState>().flushes.lock().unwrap().insert(id, (others_open, Some(tx)));
    FlushRequested { id }.emit_filter(&app, others(window.label())).ok();
    let _ = tokio::time::timeout(Duration::from_secs(3), rx).await;
    app.state::<WindowsState>().flushes.lock().unwrap().remove(&id);
    Ok(())
}

/// This window saved its editors (`FlushRequested`).
#[tauri::command]
#[specta::specta]
pub fn windows_flushed(state: tauri::State<WindowsState>, id: u32) {
    let mut flushes = state.flushes.lock().unwrap();
    if let Some((left, tx)) = flushes.get_mut(&id) {
        *left = left.saturating_sub(1);
        if *left == 0 {
            if let Some(tx) = tx.take() {
                let _ = tx.send(());
            }
        }
    }
}
