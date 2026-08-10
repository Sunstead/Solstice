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
    for menu in &layout {
        let submenu = build_submenu(app, &menu.title, &menu.entries).map_err(|e| e.to_string())?;
        b = b.item(&submenu);
    }
    b.build().map_err(|e| e.to_string())
}
