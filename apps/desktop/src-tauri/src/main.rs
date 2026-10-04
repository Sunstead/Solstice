// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // `solstice --export-bindings [path]` writes the frontend's command and
    // event bindings (and the web app's command registry) and exits,
    // without opening a window.
    let mut args = std::env::args().skip(1);
    if args.next().as_deref() == Some("--export-bindings") {
        let path = args.next().unwrap_or_else(|| "../src/bindings.ts".into());
        solstice_lib::export_bindings(std::path::Path::new(&path));
        solstice_lib::export_registry(std::path::Path::new(solstice_lib::REGISTRY_PATH));
        return;
    }
    solstice_lib::run()
}
