#[allow(unused_imports)]
use tauri::{ Emitter, LogicalPosition, Manager, WebviewUrl, WebviewWindowBuilder };
use tauri::utils::config::WindowConfig;

mod workspace;
mod files;
mod types;
mod commands;

use commands::keymap::KeymapChanged;

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
            files::exists,
            workspace::set_workspace,
            workspace::get_workspace,
            commands::keymap::get_command_registry,
            commands::keymap::set_keybind,
        ])
        .events(tauri_specta::collect_events![KeymapChanged])
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = specta_builder();

    // Regenerates bindings.ts on every `tauri dev` build so the frontend
    // types can never drift from the Rust command/event definitions.
    #[cfg(debug_assertions)]
    builder
        .export(
            specta_typescript::Typescript::default(),
            "../src/bindings.ts", // adjust to wherever your frontend src/ lives
        )
        .expect("failed to export typescript bindings");

    tauri::Builder
        ::default()
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(workspace::WorkspaceState::new())
        .invoke_handler(builder.invoke_handler())
        .setup(move |app| {
            // Registers the event registry so `events.keymapChanged.listen(...)`
            // works on the frontend.
            builder.mount_events(app);

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
                    .traffic_light_position(LogicalPosition::new(16.0, 20.0))
            };

            #[cfg(not(target_os = "macos"))]
            let win_builder = win_builder.decorations(false);

            let _window = win_builder.build()?;

            #[cfg(target_os = "macos")]
            {
                let native_menu = commands::menu::build_menu(app.handle())
                    .map_err(|e| tauri::Error::Anyhow(anyhow::anyhow!(e)))?;
                app.set_menu(native_menu)?;
            }

            Ok(())
        })
        .on_menu_event(|app, event| {
            app.emit("menu", event.id().0.clone()).ok();
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}