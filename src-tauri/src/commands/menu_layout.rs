use std::collections::HashMap;

use serde::{ Deserialize, Serialize };
use specta::Type;
use tauri::AppHandle;
use tauri_specta::Event;

use crate::commands::command_registry::{ CommandId, CommandMeta };
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

/// A registry command was activated from the native menu bar -- either by
/// click or by the OS dispatching its accelerator. The frontend runs it
/// through the same handler registry a keybind would, so both paths are
/// indistinguishable downstream.
#[derive(Debug, Clone, Serialize, Deserialize, Type, Event)]
pub struct MenuCommand(pub CommandId);

// ---------------------------------------------------------------------
// Declarative spec
// ---------------------------------------------------------------------

enum MenuEntrySpec {
    Command(CommandId),
    Native(NativeItem),
    Separator,
    Submenu(&'static str, Vec<MenuEntrySpec>),
}

fn menu_spec() -> Vec<(&'static str, Vec<MenuEntrySpec>)> {
    use MenuEntrySpec::*;
    use NativeItem::*;
    use CommandId::*;
    vec![
        (
            "File",
            vec![
                Command(FileNewNote),
                Command(FileNewFolder),
                Command(FileNewTab),
                Separator,
                Command(FileOpenFile),
                Command(FileOpenFolder),
                Separator,
                Command(FileCloseTab)
            ],
        ),
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
        ("View", vec![Command(ViewToggleSidebar)]),
        (
            "Format",
            vec![
                Command(EditBold),
                Command(EditItalic),
                Command(EditInlineCode),
                Command(EditStrikethrough),
                Separator,
                Submenu(
                    "Turn into",
                    vec![
                        Command(EditParagraph),
                        Command(EditHeading1),
                        Command(EditHeading2),
                        Command(EditHeading3),
                        Command(EditHeading4),
                        Command(EditHeading5),
                        Command(EditHeading6),
                        Separator,
                        Command(EditBlockquote),
                        Command(EditBulletList),
                        Command(EditOrderedList),
                        Command(EditCodeBlock)
                    ]
                ),
                Separator,
                Command(EditHardBreak)
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
    lookup: &HashMap<CommandId, &CommandMeta>
) -> Option<ResolvedMenuEntry> {
    match spec {
        MenuEntrySpec::Command(id) =>
            match lookup.get(id) {
                Some(meta) => Some(ResolvedMenuEntry::Command((*meta).clone())),
                None => {
                    debug_assert!(
                        false,
                        "menu_layout references unresolved command id: {}",
                        id.as_str()
                    );
                    eprintln!("menu_layout: unresolved command id \"{}\", skipping", id.as_str());
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
    let lookup: HashMap<CommandId, &CommandMeta> = commands
        .iter()
        .map(|c| (c.id, c))
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

fn collect_accelerated_commands(entries: &[ResolvedMenuEntry], out: &mut Vec<CommandId>) {
    for entry in entries {
        match entry {
            ResolvedMenuEntry::Command(c) if c.default_accelerator.is_some() => out.push(c.id),
            ResolvedMenuEntry::Submenu { entries, .. } =>
                collect_accelerated_commands(entries, out),
            _ => {}
        }
    }
}

#[tauri::command]
#[specta::specta]
pub fn get_menu_layout(app: AppHandle) -> Vec<ResolvedMenu> {
    resolve_menu_layout(&app)
}

/// Commands whose accelerator is dispatched by the OS before the webview
/// ever sees the keystroke. Only macOS installs a native menu, so every
/// other platform leaves the whole registry to the frontend; the frontend
/// binds exactly what is missing from this list, which keeps one
/// accelerator to one dispatcher and rules out double-firing.
#[tauri::command]
#[specta::specta]
pub fn get_native_menu_command_ids(app: AppHandle) -> Vec<CommandId> {
    if !cfg!(target_os = "macos") {
        return Vec::new();
    }

    let mut ids = Vec::new();
    for menu in resolve_menu_layout(&app) {
        collect_accelerated_commands(&menu.entries, &mut ids);
    }
    ids
}