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

/// Items that belong in the macOS application menu (Solstice > ...) rather
/// than in any top-level menu of their own. Kept in the same declarative
/// form as `menu_spec` so `get_native_menu_command_ids` can see them -- an
/// accelerator the OS claims here must not also be bound in the frontend.
fn app_menu_spec() -> Vec<MenuEntrySpec> {
    vec![MenuEntrySpec::Command(CommandId::AppSettings)]
}

fn menu_spec() -> Vec<(&'static str, Vec<MenuEntrySpec>)> {
    use MenuEntrySpec::*;
    use NativeItem::*;
    use CommandId::*;
    vec![
        (
            "File",
            {
                let mut items = vec![
                    Command(FileNewNote),
                    Command(FileNewFolder),
                    Command(FileNewTab),
                    Separator,
                    Command(FileOpenFile),
                    Command(FileOpenFolder),
                    Separator,
                    // A submenu rather than a flat block: these all act on
                    // whatever the focused tab has open, and inlining ten of
                    // them would bury New/Open under a wall of file actions.
                    Submenu(
                        "Current File",
                        vec![
                            Command(FileRevealInExplorer),
                            Command(FileRevealInSystem),
                            Command(FileOpenInDefaultApp),
                            Separator,
                            Command(FileCopyPath),
                            Command(FileCopyRelativePath),
                            Command(FileCopyWikilink),
                            Separator,
                            Command(FileRename),
                            Command(FileDuplicate),
                            Command(FileMoveTo),
                            Separator,
                            Command(FileDelete)
                        ]
                    ),
                    Separator,
                    Command(FileCloseTab)
                ];
                // Only macOS has an application menu to put Settings in;
                // everywhere else it belongs at the bottom of File.
                if !cfg!(target_os = "macos") {
                    items.push(Separator);
                    items.push(Command(AppSettings));
                }
                items
            },
        ),
        (
            "Edit",
            vec![
                Command(EditFind),
                Separator,
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
                Command(EditInsertImage),
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

fn command_lookup(commands: &[CommandMeta]) -> HashMap<CommandId, &CommandMeta> {
    commands
        .iter()
        .map(|c| (c.id, c))
        .collect()
}

/// The custom entries for the macOS application menu, with accelerators
/// resolved against any keymap overrides. Empty on other platforms, where
/// these items are folded into `menu_spec` instead.
pub fn resolve_app_menu(app: &AppHandle) -> Vec<ResolvedMenuEntry> {
    if !cfg!(target_os = "macos") {
        return Vec::new();
    }

    let commands = resolved_commands(app);
    let lookup = command_lookup(&commands);
    app_menu_spec()
        .iter()
        .filter_map(|e| resolve_entry(e, &lookup))
        .collect()
}

pub fn resolve_menu_layout(app: &AppHandle) -> Vec<ResolvedMenu> {
    let commands = resolved_commands(app);
    let lookup = command_lookup(&commands);

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
            ResolvedMenuEntry::Command(c) if c.accelerator.is_some() => out.push(c.id),
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
    collect_accelerated_commands(&resolve_app_menu(&app), &mut ids);
    for menu in resolve_menu_layout(&app) {
        collect_accelerated_commands(&menu.entries, &mut ids);
    }
    ids
}