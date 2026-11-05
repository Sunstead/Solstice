//! On macOS the webview is wry's `WKWebView` subclass. Its
//! `performDragOperation:` is wrapped, once for the class: the drag's file
//! names are noted, then wry's own runs, which hands the drop to the page.

use std::sync::OnceLock;

use objc2::rc::Retained;
use objc2::runtime::{AnyObject, Bool, Imp, Sel};
use objc2::{msg_send, sel};
use objc2_foundation::{NSArray, NSString};

/// wry's `performDragOperation:`, called after the paths are noted.
static ORIGINAL: OnceLock<Imp> = OnceLock::new();

type Perform = unsafe extern "C-unwind" fn(*mut AnyObject, Sel, *mut AnyObject) -> Bool;

unsafe extern "C-unwind" fn perform(this: *mut AnyObject, sel: Sel, info: *mut AnyObject) -> Bool {
    // SAFETY: `info` is the `NSDraggingInfo` AppKit passes this method.
    super::note(unsafe { file_names(info) });
    let original = ORIGINAL.get().expect("wrapped without an original");
    // SAFETY: the original has this method's signature; it was swapped for it.
    let original: Perform = unsafe { std::mem::transmute(*original) };
    unsafe { original(this, sel, info) }
}

/// The paths on a drag's pasteboard, as wry reads them (`NSFilenamesPboardType`).
unsafe fn file_names(info: *mut AnyObject) -> Vec<String> {
    let Some(info) = (unsafe { info.as_ref() }) else { return Vec::new() };
    let pasteboard: Option<Retained<AnyObject>> = unsafe { msg_send![info, draggingPasteboard] };
    let Some(pasteboard) = pasteboard else { return Vec::new() };
    let kind = NSString::from_str("NSFilenamesPboardType");
    let list: Option<Retained<AnyObject>> = unsafe { msg_send![&pasteboard, propertyListForType: &*kind] };
    let Some(list) = list.and_then(|l| l.downcast::<NSArray>().ok()) else { return Vec::new() };
    list.iter()
        .filter_map(|item| item.downcast::<NSString>().ok())
        .map(|name| name.to_string())
        .collect()
}

pub fn watch<R: tauri::Runtime>(window: &tauri::WebviewWindow<R>) {
    let _ = window.with_webview(|webview| {
        if ORIGINAL.get().is_some() {
            return;
        }
        // SAFETY: `inner` is the window's live WKWebView.
        let view = unsafe { &*(webview.inner() as *mut AnyObject) };
        let Some(method) = view.class().instance_method(sel!(performDragOperation:)) else { return };
        // SAFETY: `perform` has the method's signature (BOOL (id, SEL, id)),
        // and keeps calling what it replaces.
        let previous = unsafe { method.set_implementation(std::mem::transmute::<Perform, Imp>(perform)) };
        let _ = ORIGINAL.set(previous);
    });
}
