/// Native methods the webview may call (`plugin:solstice-native|<name>`);
/// Rust reaches the rest through `NativeExt`.
const COMMANDS: &[&str] = &["surface", "host"];

fn main() {
    tauri_plugin::Builder::new(COMMANDS).ios_path("ios").build();
}
