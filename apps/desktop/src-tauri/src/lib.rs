#[allow(unused_imports)]
use tauri::{ Emitter, LogicalPosition, Manager, WebviewUrl, WebviewWindowBuilder };
use tauri::utils::config::WindowConfig;
use tauri_specta::Event as _;

mod workspace;
mod files;
mod types;
mod commands;
mod watcher;
mod sync;

use commands::command_registry::CommandId;
use commands::keymap::KeymapChanged;
use commands::menu_layout::MenuCommand;
use watcher::FileSystemChanged;

/// Single source of truth for the typed command/event surface. Built once so
/// the same collected set backs both the runtime invoke_handler and the
/// dev-time TypeScript export below.
fn specta_builder() -> tauri_specta::Builder<tauri::Wry> {
    tauri_specta::Builder::<tauri::Wry>::new()
        .commands(tauri_specta::collect_commands![
            files::list_directory,
            files::read_file,
            files::write_file,
            files::create_file,
            files::create_directory,
            files::rename_path,
            files::delete_file,
            files::delete_directory,
            files::copy_path,
            files::move_path,
            files::trash_path,
            files::duplicate_path,
            files::exists,
            files::save_attachment,
            files::import_attachment,
            files::list_workspace_files_recursive,
            workspace::set_workspace,
            workspace::get_workspace,
            workspace::allow_asset_path,
            workspace::set_watch_enabled,
            commands::keymap::get_command_registry,
            commands::keymap::set_keybind,
            commands::keymap::clear_keybind,
            commands::keymap::set_menu_accelerators_enabled,
            commands::menu_layout::get_menu_layout,
            commands::menu_layout::get_native_menu_command_ids,
            commands::themes::list_user_themes,
            commands::themes::ensure_theme_dir,
            commands::fonts::list_system_fonts,
            sync::sync_server_info,
            sync::sync_sign_in,
            sync::sync_sign_out,
            sync::sync_vaults,
            sync::sync_create_vault,
            sync::sync_create_token,
            sync::sync_link,
            sync::sync_unlink,
            sync::sync_status,
            sync::sync_reconnect,
            sync::sync_reviews,
            sync::sync_review_versions,
            sync::sync_resolve_review,
            sync::sync_editor_opened,
            sync::sync_vault_names,
        ])
        .events(tauri_specta::collect_events![KeymapChanged, MenuCommand, FileSystemChanged, sync::SyncChanged])
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = specta_builder();

    // Regenerates bindings.ts on every `tauri dev` build so the frontend
    // types can never drift from the Rust command/event definitions.
    #[cfg(debug_assertions)]
    export_bindings(std::path::Path::new("../src/bindings.ts"));

    let app = tauri::Builder::default();

    // First, so a second launch (e.g. a `solstice://` link clicked while the
    // app runs) hands its arguments to this process and exits. The
    // `deep-link` feature passes the link on to the deep-link plugin.
    #[cfg(desktop)]
    let app = app.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.unminimize();
            let _ = window.set_focus();
        }
    }));

    app
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(workspace::WorkspaceState::new())
        .manage(watcher::FsWatcherState::new())
        .manage(sync::SyncState::default())
        .manage(commands::keymap::MenuAccelerators::default())
        .invoke_handler(builder.invoke_handler())
        .setup(move |app| {
            // Registers the event registry so `events.keymapChanged.listen(...)`
            // works on the frontend.
            builder.mount_events(app);

            // Installers register `solstice://` on Windows and Linux; this
            // covers dev builds and AppImages. macOS reads it from the bundle.
            #[cfg(any(windows, target_os = "linux"))]
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                if let Err(e) = app.deep_link().register_all() {
                    eprintln!("Couldn't register solstice:// links: {e}");
                }
            }

            let config = WindowConfig {
                label: "main".into(),
                url: WebviewUrl::default(),
                drag_drop_enabled: false,
                ..Default::default()
            };

            let win_builder = WebviewWindowBuilder::from_config(app, &config)?
                .title("Solstice")
                .inner_size(1200.0, 800.0);

            #[cfg(target_os = "macos")]
            let win_builder = {
                use tauri::TitleBarStyle;
                win_builder
                    .title_bar_style(TitleBarStyle::Overlay)
                    .hidden_title(true)
                    .traffic_light_position(LogicalPosition::new(16.0, 22.0))
            };

            #[cfg(not(target_os = "macos"))]
            let win_builder = win_builder.decorations(false);

            win_builder.build()?;

            #[cfg(target_os = "macos")]
            {
                let native_menu = commands::menu::build_menu(app.handle())
                    .map_err(|e| tauri::Error::Anyhow(anyhow::anyhow!(e)))?;
                app.set_menu(native_menu)?;

            }

            Ok(())
        })
        .on_window_event(|window, event| {
            // The watcher owns a thread and a live file-id cache; a closed
            // window must not leave either behind.
            if matches!(event, tauri::WindowEvent::Destroyed) {
                watcher::unwatch(window.label(), &window.state::<watcher::FsWatcherState>());
                sync::window_closed(window.app_handle(), window.label());
            }
        })
        .on_menu_event(|app, event| {
            #[cfg(debug_assertions)]
            {
                match event.id().0.as_str() {
                    "debug.reload" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.eval("window.location.reload()");
                        }
                        return;
                    }
                    "debug.toggle_devtools" => {
                        if let Some(window) = app.get_webview_window("main") {
                            window.open_devtools();
                        }
                        return;
                    }
                    _ => {}
                }
            }

            // Predefined OS items carry ids outside the registry and are
            // already handled natively, so they simply fail to parse here.
            if let Ok(id) = event.id().0.parse::<CommandId>() {
                MenuCommand(id).emit(app).ok();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
/// Writes the frontend's command and event bindings (`src/bindings.ts`).
/// Debug runs do it on startup; `solstice --export-bindings` does it alone.
pub fn export_bindings(path: &std::path::Path) {
    specta_builder()
        .export(specta_typescript::Typescript::default(), path)
        .expect("failed to export typescript bindings");
}

// Windows test binaries can't load once they reference the app's UI code
// (Tauri embeds the manifest that needs only into the real executable), so
// this runs on macOS and Linux, which is where CI is.
#[cfg(all(test, not(windows)))]
mod bindings {
    #[test]
    fn bindings_are_current() {
        let read = |p: &std::path::Path| std::fs::read_to_string(p).unwrap_or_default().replace("\r\n", "\n");
        let fresh = std::env::temp_dir().join(format!("solstice-bindings-{}.ts", std::process::id()));
        super::export_bindings(&fresh);
        let (fresh_text, committed) = (read(&fresh), read(std::path::Path::new("../src/bindings.ts")));
        let _ = std::fs::remove_file(&fresh);
        assert!(
            fresh_text == committed,
            "src/bindings.ts is stale: run `cargo run -p solstice -- --export-bindings` in apps/desktop/src-tauri"
        );
    }
}
