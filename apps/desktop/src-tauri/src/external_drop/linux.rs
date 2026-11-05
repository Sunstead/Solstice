//! On Linux the webview is WebKitGTK's: its `drag-data-received` signal
//! carries the drop's URIs, and a handler connected to it leaves WebKit's
//! own (which hands the drop to the page) to run after.

use gtk::glib;
use gtk::prelude::*;

pub fn watch<R: tauri::Runtime>(window: &tauri::WebviewWindow<R>) {
    let _ = window.with_webview(|webview| {
        webview.inner().connect_drag_data_received(|_, _, _, _, data, _, _| {
            let paths = data
                .uris()
                .iter()
                .filter_map(|uri| glib::filename_from_uri(uri).ok())
                .map(|(path, _)| path.to_string_lossy().into_owned())
                .collect();
            super::note(paths);
        });
    });
}
