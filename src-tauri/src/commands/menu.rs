use tauri::{
    menu::{Menu, MenuBuilder, MenuItemBuilder, Submenu, SubmenuBuilder},
    AppHandle,
};

use crate::commands::command_registry::{CommandGroup, CommandMeta};
use crate::commands::keymap::resolved_commands;

fn filter(cmds: &[CommandMeta], g: CommandGroup) -> Vec<CommandMeta> {
    cmds.iter().filter(|c| c.group == g).cloned().collect()
}

fn plain_submenu(app: &AppHandle, title: &str, cmds: &[CommandMeta]) -> tauri::Result<Submenu<tauri::Wry>> {
    let mut b = SubmenuBuilder::new(app, title);
    for c in cmds {
        let mut item = MenuItemBuilder::new(&c.label).id(&c.id);
        if let Some(a) = &c.default_accelerator {
            item = item.accelerator(a);
        }
        b = b.item(&item.build(app)?);
    }
    b.build()
}

fn edit_submenu(app: &AppHandle, cmds: &[CommandMeta]) -> tauri::Result<Submenu<tauri::Wry>> {
    let mut b = SubmenuBuilder::new(app, "Edit")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .separator();
    for c in cmds {
        let mut item = MenuItemBuilder::new(&c.label).id(&c.id);
        if let Some(a) = &c.default_accelerator {
            item = item.accelerator(a);
        }
        b = b.item(&item.build(app)?);
    }
    b.build()
}

pub fn build_menu(app: &AppHandle) -> Result<Menu<tauri::Wry>, String> {
    let cmds = resolved_commands(app);
    let file = plain_submenu(app, "File", &filter(&cmds, CommandGroup::File)).map_err(|e| e.to_string())?;
    let edit = edit_submenu(app, &filter(&cmds, CommandGroup::Edit)).map_err(|e| e.to_string())?;
    let view = plain_submenu(app, "View", &filter(&cmds, CommandGroup::View)).map_err(|e| e.to_string())?;
    MenuBuilder::new(app)
        .item(&file)
        .item(&edit)
        .item(&view)
        .build()
        .map_err(|e| e.to_string())
}