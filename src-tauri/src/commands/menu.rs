use tauri::{
    menu::{ Menu, MenuBuilder, MenuItemBuilder, PredefinedMenuItem, Submenu, SubmenuBuilder },
    AppHandle,
};

use crate::commands::menu_layout::{ resolve_menu_layout, NativeItem, ResolvedMenuEntry };

fn build_submenu(
    app: &AppHandle,
    title: &str,
    entries: &[ResolvedMenuEntry]
) -> tauri::Result<Submenu<tauri::Wry>> {
    let mut b = SubmenuBuilder::new(app, title);
    for entry in entries {
        b = match entry {
            ResolvedMenuEntry::Command(c) => {
                let mut item = MenuItemBuilder::new(&c.label).id(&c.id);
                if let Some(a) = &c.default_accelerator {
                    item = item.accelerator(a);
                }
                b.item(&item.build(app)?)
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
                b.item(&build_submenu(app, title, entries)?)
            }
        };
    }
    b.build()
}

pub fn build_menu(app: &AppHandle) -> Result<Menu<tauri::Wry>, String> {
    let layout = resolve_menu_layout(app);
    let mut b = MenuBuilder::new(app);

    // macOS always treats the menu bar's first top-level item as the app
    // menu, no matter what it is -- without one of our own here, "File"
    // (our actual first item) would silently take that slot instead of
    // appearing as its own menu. `None` on each predefined item lets Tauri
    // fill in the app's real name (matching "Quit Solstice" etc.).
    let app_menu = SubmenuBuilder::new(app, "Solstice")
        .item(&PredefinedMenuItem::about(app, None, None).map_err(|e| e.to_string())?)
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
        let submenu = build_submenu(app, &menu.title, &menu.entries).map_err(|e| e.to_string())?;
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
        let reload = MenuItemBuilder::new("Reload")
            .id("debug.reload")
            .accelerator("CmdOrCtrl+R")
            .build(app)
            .map_err(|e| e.to_string())?;
        let toggle_devtools = MenuItemBuilder::new("Toggle Developer Tools")
            .id("debug.toggle_devtools")
            .accelerator("CmdOrCtrl+Alt+I")
            .build(app)
            .map_err(|e| e.to_string())?;
        let debug_menu = SubmenuBuilder::new(app, "Debug")
            .item(&reload)
            .item(&toggle_devtools)
            .build()
            .map_err(|e| e.to_string())?;
        b = b.item(&debug_menu);
    }

    b.build().map_err(|e| e.to_string())
}