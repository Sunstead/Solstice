#[allow(unused_imports)]
use tauri::{ LogicalPosition, WebviewUrl, WebviewWindowBuilder };

mod workspace;
mod files;
mod types;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder
        ::default()
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(workspace::WorkspaceState::new())
        .invoke_handler(
            tauri::generate_handler![
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
                workspace::get_workspace
            ]
        )

        .setup(|app| {
            let win_builder = WebviewWindowBuilder::new(app, "main", WebviewUrl::default())
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
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
