use tauri::{
    menu::{ Menu, MenuBuilder, MenuItemBuilder, PredefinedMenuItem, Submenu, SubmenuBuilder },
    AppHandle,
};

use crate::commands::keymap::menu_accelerators_enabled;
use crate::commands::menu_layout::{
    resolve_app_menu,
    resolve_menu_layout,
    NativeItem,
    ResolvedMenuEntry,
};

fn command_item(
    app: &AppHandle,
    entry: &ResolvedMenuEntry,
    accelerators: bool
) -> tauri::Result<Option<tauri::menu::MenuItem<tauri::Wry>>> {
    let ResolvedMenuEntry::Command(c) = entry else {
        return Ok(None);
    };
    let mut item = MenuItemBuilder::new(&c.label).id(&c.id);
    if let (true, Some(a)) = (accelerators, &c.accelerator) {
        item = item.accelerator(a);
    }
    Ok(Some(item.build(app)?))
}

fn build_submenu(
    app: &AppHandle,
    title: &str,
    entries: &[ResolvedMenuEntry],
    accelerators: bool
) -> tauri::Result<Submenu<tauri::Wry>> {
    let mut b = SubmenuBuilder::new(app, title);
    for entry in entries {
        b = match entry {
            ResolvedMenuEntry::Command(_) => {
                match command_item(app, entry, accelerators)? {
                    Some(item) => b.item(&item),
                    None => b,
                }
            }
            // Native items map straight to Tauri's OS-linked predefined
            // items -- same free, zero-JS behavior as before.
            ResolvedMenuEntry::Native { item, .. } => {
                let predefined = match item {
                    NativeItem::Undo => PredefinedMenuItem::undo(app, None)?,
                    NativeItem::Redo => PredefinedMenuItem::redo(app, None)?,
                    NativeItem::Cut => PredefinedMenuItem::cut(app, None)?,
                    NativeItem::Copy => PredefinedMenuItem::copy(app, None)?,
                    NativeItem::Paste => PredefinedMenuItem::paste(app, None)?,
                    NativeItem::SelectAll => PredefinedMenuItem::select_all(app, None)?,
                };
                b.item(&predefined)
            }
            ResolvedMenuEntry::Separator => b.separator(),
            ResolvedMenuEntry::Submenu { title, entries } => {
                b.item(&build_submenu(app, title, entries, accelerators)?)
            }
        };
    }
    b.build()
}

pub fn build_menu(app: &AppHandle) -> Result<Menu<tauri::Wry>, String> {
    // Cleared while the settings pane is recording a keystroke, so the OS does
    // not consume the combo before the webview sees it.
    let accelerators = menu_accelerators_enabled(app);
    let layout = resolve_menu_layout(app);
    let mut b = MenuBuilder::new(app);

    // macOS always treats the menu bar's first top-level item as the app
    // menu, no matter what it is -- without one of our own here, "File"
    // (our actual first item) would silently take that slot instead of
    // appearing as its own menu. `None` on each predefined item lets Tauri
    // fill in the app's real name (matching "Quit Solstice" etc.).
    let mut app_menu_builder = SubmenuBuilder::new(app, "Solstice")
        .item(&PredefinedMenuItem::about(app, None, None).map_err(|e| e.to_string())?)
        .separator();

    // Registry commands that belong in the app menu rather than a top-level
    // one -- Settings, on macOS. They resolve through the keymap like any
    // other command, so an override changes this accelerator too.
    for entry in resolve_app_menu(app) {
        if let Some(item) = command_item(app, &entry, accelerators).map_err(|e| e.to_string())? {
            app_menu_builder = app_menu_builder.item(&item);
        }
    }

    let app_menu = app_menu_builder
        .separator()
        .item(&PredefinedMenuItem::services(app, None).map_err(|e| e.to_string())?)
        .separator()
        .item(&PredefinedMenuItem::hide(app, None).map_err(|e| e.to_string())?)
        .item(&PredefinedMenuItem::hide_others(app, None).map_err(|e| e.to_string())?)
        .item(&PredefinedMenuItem::show_all(app, None).map_err(|e| e.to_string())?)
        .separator()
        .item(&PredefinedMenuItem::quit(app, None).map_err(|e| e.to_string())?)
        .build()
        .map_err(|e| e.to_string())?;
    b = b.item(&app_menu);

    for menu in &layout {
        let submenu = build_submenu(app, &menu.title, &menu.entries, accelerators).map_err(|e|
            e.to_string()
        )?;
        b = b.item(&submenu);
    }

    // macOS routes Cmd+key shortcuts through the app menu's key-equivalent
    // table before the webview ever sees them -- with no menu item claiming
    // an accelerator, the keystroke is swallowed and never reaches the DOM
    // as a keydown event. These two items exist purely to give Reload and
    // DevTools a native key equivalent to bind to; they're not real app
    // commands, so they intentionally live outside CommandId/menu_layout
    // and only exist in debug builds.
    #[cfg(debug_assertions)]
    {
        let mut reload = MenuItemBuilder::new("Reload").id("debug.reload");
        let mut toggle_devtools = MenuItemBuilder::new("Toggle Developer Tools").id(
            "debug.toggle_devtools"
        );
        if accelerators {
            reload = reload.accelerator("CmdOrCtrl+R");
            toggle_devtools = toggle_devtools.accelerator("CmdOrCtrl+Alt+I");
        }
        let reload = reload.build(app).map_err(|e| e.to_string())?;
        let toggle_devtools = toggle_devtools.build(app).map_err(|e| e.to_string())?;
        let debug_menu = SubmenuBuilder::new(app, "Debug")
            .item(&reload)
            .item(&toggle_devtools)
            .build()
            .map_err(|e| e.to_string())?;
        b = b.item(&debug_menu);
    }

    b.build().map_err(|e| e.to_string())
}