use std::collections::HashMap;
use std::sync::Mutex;

use serde::{ Deserialize, Serialize };
use serde_json::json;
use specta::Type;
use tauri::{ AppHandle, Manager };
use tauri_plugin_store::StoreExt;
use tauri_specta::Event;

use crate::commands::command_registry::{ self, CommandId, CommandMeta };

#[cfg(target_os = "macos")]
use crate::commands::menu;

const KEYMAP_STORE: &str = "keymap.json";
const OVERRIDES_KEY: &str = "overrides";

/// Whether the native menu currently claims its key equivalents.
///
/// Held in app state rather than passed to `build_menu` so that every rebuild
/// honours it -- saving a binding mid-capture would otherwise silently re-arm
/// the whole menu and start swallowing the next keystroke.
pub struct MenuAccelerators(pub Mutex<bool>);

impl Default for MenuAccelerators {
    fn default() -> Self {
        Self(Mutex::new(true))
    }
}

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

fn write_overrides(app: &AppHandle, overrides: HashMap<String, String>) -> Result<(), String> {
    let store = app.store(KEYMAP_STORE).map_err(|e| e.to_string())?;
    store.set(OVERRIDES_KEY, json!(overrides));
    store.save().map_err(|e| e.to_string())?;
    Ok(())
}

/// Rebuild and reinstall the native menu so a keymap change takes effect
/// without a restart. Only macOS installs one.
fn refresh_menu(app: &AppHandle) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let new_menu = menu::build_menu(app)?;
        app.set_menu(new_menu).map_err(|e| e.to_string())?;
    }
    #[cfg(not(target_os = "macos"))]
    let _ = app;
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
                c.accelerator = Some(accel.clone());
                c.is_overridden = true;
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
    let mut overrides = load_overrides(&app);
    overrides.insert(command_id.as_str().to_string(), accelerator);
    write_overrides(&app, overrides)?;

    refresh_menu(&app)?;
    KeymapChanged.emit(&app).map_err(|e| e.to_string())?;
    Ok(())
}

/// Drop a command's override so it falls back to its compiled-in default.
#[tauri::command]
#[specta::specta]
pub fn clear_keybind(app: AppHandle, command_id: CommandId) -> Result<(), String> {
    let mut overrides = load_overrides(&app);
    if overrides.remove(command_id.as_str()).is_none() {
        return Ok(());
    }
    write_overrides(&app, overrides)?;

    refresh_menu(&app)?;
    KeymapChanged.emit(&app).map_err(|e| e.to_string())?;
    Ok(())
}

/// Release the native menu's key equivalents so the frontend can record a
/// keystroke that the OS would otherwise consume before the webview sees it.
/// Menu items stay visible and clickable throughout.
#[tauri::command]
#[specta::specta]
pub fn set_menu_accelerators_enabled(app: AppHandle, enabled: bool) -> Result<(), String> {
    {
        let state = app.state::<MenuAccelerators>();
        let mut flag = state.0.lock().map_err(|e| e.to_string())?;
        if *flag == enabled {
            return Ok(());
        }
        *flag = enabled;
    }
    refresh_menu(&app)
}

/// Whether menu items should be built with their accelerators attached.
pub fn menu_accelerators_enabled(app: &AppHandle) -> bool {
    app.state::<MenuAccelerators>()
        .0.lock()
        .map(|flag| *flag)
        .unwrap_or(true)
}
