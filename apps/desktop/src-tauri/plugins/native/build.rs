/// Native methods the webview may call (`plugin:solstice-native|<name>`),
/// and the listener registration behind `addPluginListener`; Rust reaches
/// the rest through `NativeExt`.
const COMMANDS: &[&str] = &["surface", "host", "register_listener", "remove_listener"];

fn main() {
    tauri_plugin::Builder::new(COMMANDS).ios_path("ios").build();
}
