use std::collections::HashMap;

use serde::{ Deserialize, Serialize };
use serde_json::json;
use specta::Type;
use tauri::AppHandle;
use tauri_plugin_store::StoreExt;
use tauri_specta::Event;

use crate::commands::command_registry::{ self, CommandId, CommandMeta };

#[cfg(target_os = "macos")]
use crate::commands::menu;

const KEYMAP_STORE: &str = "keymap.json";
const OVERRIDES_KEY: &str = "overrides";

/// Fired whenever the resolved keymap changes (an override was saved).
/// Every frontend consumer of the keymap — titlebar, tinykeys, the Milkdown
/// keymap plugin — listens for this instead of polling.
#[derive(Debug, Clone, Serialize, Deserialize, Type, Event)]
pub struct KeymapChanged;

/// On-disk overrides stay keyed by the plain dotted string (`"edit.bold"`),
/// not `CommandId` itself -- this is user data that outlives any given
/// build, so it should stay a stable, inspectable string rather than
/// something tied to serde's enum representation. `CommandId::as_str()` /
/// its `Display` impl are what bridge the two.
fn load_overrides(app: &AppHandle) -> HashMap<String, String> {
    app.store(KEYMAP_STORE)
        .ok()
        .and_then(|store| store.get(OVERRIDES_KEY))
        .and_then(|v| serde_json::from_value(v).ok())
        .unwrap_or_default()
}

fn save_override(app: &AppHandle, command_id: CommandId, accelerator: &str) -> Result<(), String> {
    let store = app.store(KEYMAP_STORE).map_err(|e| e.to_string())?;
    let mut overrides = load_overrides(app);
    overrides.insert(command_id.as_str().to_string(), accelerator.to_string());
    store.set(OVERRIDES_KEY, json!(overrides));
    store.save().map_err(|e| e.to_string())?;
    Ok(())
}

/// The only list anything downstream should read.
pub fn resolved_commands(app: &AppHandle) -> Vec<CommandMeta> {
    let overrides = load_overrides(app);
    command_registry
        ::default_commands()
        .into_iter()
        .map(|mut c| {
            if let Some(accel) = overrides.get(c.id.as_str()) {
                c.default_accelerator = Some(accel.clone());
            }
            c
        })
        .collect()
}

#[tauri::command]
#[specta::specta]
pub fn get_command_registry(app: AppHandle) -> Vec<CommandMeta> {
    resolved_commands(&app)
}

#[tauri::command]
#[specta::specta]
pub fn set_keybind(
    app: AppHandle,
    command_id: CommandId,
    accelerator: String
) -> Result<(), String> {
    save_override(&app, command_id, &accelerator)?;

    #[cfg(target_os = "macos")]
    {
        let new_menu = menu::build_menu(&app)?;
        app.set_menu(new_menu).map_err(|e| e.to_string())?;
    }

    KeymapChanged.emit(&app).map_err(|e| e.to_string())?;
    Ok(())
}
