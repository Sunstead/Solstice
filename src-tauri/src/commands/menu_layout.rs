use std::collections::HashMap;

use serde::{ Deserialize, Serialize };
use specta::Type;
use tauri::AppHandle;

use crate::commands::command_registry::{ command_ids::*, CommandMeta };
use crate::commands::keymap::resolved_commands;

/// OS-provided editing actions. Deliberately NOT CommandMeta -- no id in
/// the command registry, no rebindable accelerator, never registered as
/// a keybind. A real Ctrl+C/Ctrl+Z keystroke is already handled natively
/// by the browser/ProseMirror with zero JS involved; the only thing that
/// actually needs wiring per-platform is a MENU CLICK on one of these
/// (mac: free via the native menu, Windows: needs a small real handler
/// in the React menu bar -- see NativeItem below for the label/accel
/// shown there).
#[derive(Debug, Clone, Copy, Serialize, Deserialize, Type)]
pub enum NativeItem {
    Undo,
    Redo,
    Cut,
    Copy,
    Paste,
    SelectAll,
}

impl NativeItem {
    fn display(self) -> (&'static str, &'static str) {
        use NativeItem::*;
        match self {
            Undo => ("Undo", "CmdOrCtrl+Z"),
            Redo => ("Redo", "CmdOrCtrl+Shift+Z"),
            Cut => ("Cut", "CmdOrCtrl+X"),
            Copy => ("Copy", "CmdOrCtrl+C"),
            Paste => ("Paste", "CmdOrCtrl+V"),
            SelectAll => ("Select All", "CmdOrCtrl+A"),
        }
    }
}

// ---------------------------------------------------------------------
// Declarative spec
// ---------------------------------------------------------------------

enum MenuEntrySpec {
    Command(&'static str),
    Native(NativeItem),
    Separator,
    Submenu(&'static str, Vec<MenuEntrySpec>),
}

fn menu_spec() -> Vec<(&'static str, Vec<MenuEntrySpec>)> {
    use MenuEntrySpec::*;
    use NativeItem::*;
    vec![
        ("File", vec![Command(FILE_NEW), Separator, Command(FILE_OPEN_FOLDER)]),
        (
            "Edit",
            vec![
                Native(Undo),
                Native(Redo),
                Separator,
                Native(Cut),
                Native(Copy),
                Native(Paste),
                Native(SelectAll)
            ],
        ),
        ("View", vec![Command(VIEW_TOGGLE_SIDEBAR)]),
        (
            "Format",
            vec![
                Command(EDIT_BOLD),
                Command(EDIT_ITALIC),
                Command(EDIT_INLINE_CODE),
                Command(EDIT_STRIKETHROUGH),
                Separator,
                Submenu(
                    "Turn into",
                    vec![
                        Command(EDIT_PARAGRAPH),
                        Command(EDIT_HEADING1),
                        Command(EDIT_HEADING2),
                        Command(EDIT_HEADING3),
                        Command(EDIT_HEADING4),
                        Command(EDIT_HEADING5),
                        Command(EDIT_HEADING6),
                        Separator,
                        Command(EDIT_BLOCKQUOTE),
                        Command(EDIT_BULLET_LIST),
                        Command(EDIT_ORDERED_LIST),
                        Command(EDIT_CODE_BLOCK)
                    ]
                ),
                Separator,
                Command(EDIT_HARD_BREAK)
            ],
        )
    ]
}

// ---------------------------------------------------------------------
// Resolved tree
// ---------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub enum ResolvedMenuEntry {
    Command(CommandMeta),
    Native {
        item: NativeItem,
        label: String,
        accelerator: String,
    },
    Separator,
    Submenu {
        title: String,
        entries: Vec<ResolvedMenuEntry>,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct ResolvedMenu {
    pub title: String,
    pub entries: Vec<ResolvedMenuEntry>,
}

fn resolve_entry(
    spec: &MenuEntrySpec,
    lookup: &HashMap<&str, &CommandMeta>
) -> Option<ResolvedMenuEntry> {
    match spec {
        MenuEntrySpec::Command(id) =>
            match lookup.get(id) {
                Some(meta) => Some(ResolvedMenuEntry::Command((*meta).clone())),
                None => {
                    debug_assert!(false, "menu_layout references unknown command id: {id}");
                    eprintln!("menu_layout: unknown command id \"{id}\", skipping");
                    None
                }
            }
        MenuEntrySpec::Native(item) => {
            let (label, accelerator) = item.display();
            Some(ResolvedMenuEntry::Native {
                item: *item,
                label: label.to_string(),
                accelerator: accelerator.to_string(),
            })
        }
        MenuEntrySpec::Separator => Some(ResolvedMenuEntry::Separator),
        MenuEntrySpec::Submenu(title, entries) => {
            let resolved = entries
                .iter()
                .filter_map(|e| resolve_entry(e, lookup))
                .collect();
            Some(ResolvedMenuEntry::Submenu { title: title.to_string(), entries: resolved })
        }
    }
}

pub fn resolve_menu_layout(app: &AppHandle) -> Vec<ResolvedMenu> {
    let commands = resolved_commands(app);
    let lookup: HashMap<&str, &CommandMeta> = commands
        .iter()
        .map(|c| (c.id.as_str(), c))
        .collect();

    menu_spec()
        .into_iter()
        .map(|(title, entries)| ResolvedMenu {
            title: title.to_string(),
            entries: entries
                .iter()
                .filter_map(|e| resolve_entry(e, &lookup))
                .collect(),
        })
        .collect()
}

#[tauri::command]
#[specta::specta]
pub fn get_menu_layout(app: AppHandle) -> Vec<ResolvedMenu> {
    resolve_menu_layout(&app)
}
