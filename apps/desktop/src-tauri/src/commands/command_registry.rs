use serde::{ Deserialize, Serialize };
use specta::Type;

macro_rules! command_id {
    ($($variant:ident => $str:literal),* $(,)?) => {
        #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, Type)]
        pub enum CommandId {
            $(
                #[serde(rename = $str)]
                $variant,
            )*
        }

        impl CommandId {
            /// The dotted wire-format string for this id, e.g. `"edit.bold"`.
            /// Handy anywhere you need the raw string (logging, non-serde
            /// comparisons) without round-tripping through serde_json.
            pub fn as_str(self) -> &'static str {
                match self {
                    $( CommandId::$variant => $str, )*
                }
            }
        }

        /// Native menu items carry their `CommandId` as that same dotted
        /// string, so menu activations parse straight back into an id.
        /// Predefined OS items (undo/copy/...) are not in the registry and
        /// simply fail to parse.
        impl std::str::FromStr for CommandId {
            type Err = ();

            fn from_str(s: &str) -> Result<Self, Self::Err> {
                match s {
                    $( $str => Ok(CommandId::$variant), )*
                    _ => Err(()),
                }
            }
        }
    };
}

command_id! {
    AppSettings => "app.settings",

    FileNewNote => "file.new_note",
    FileNewCanvas => "file.new_canvas",
    FileOpenFile => "file.open_file",
    FileNewTab => "file.new_tab",
    FileNewFolder => "file.new_folder",
    FileNewWorkspace => "file.new_workspace",
    FileImportFromSync => "file.import_from_sync",
    FileManageWorkspaces => "file.manage_workspaces",
    FileOpenFolder => "file.open_folder",
    FileCloseTab => "file.close_tab",

    FileRevealInExplorer => "file.reveal_in_explorer",
    FileRevealInSystem => "file.reveal_in_system",
    FileOpenInDefaultApp => "file.open_in_default_app",
    FileCopyPath => "file.copy_path",
    FileCopyRelativePath => "file.copy_relative_path",
    FileCopyWikilink => "file.copy_wikilink",
    FileRename => "file.rename",
    FileDuplicate => "file.duplicate",
    FileMoveTo => "file.move_to",
    FileDelete => "file.delete",

    EditBold => "edit.bold",
    EditItalic => "edit.italic",
    EditInlineCode => "edit.inline_code",
    EditStrikethrough => "edit.strikethrough",
    EditFind => "edit.find",

    EditHeading1 => "edit.heading1",
    EditHeading2 => "edit.heading2",
    EditHeading3 => "edit.heading3",
    EditHeading4 => "edit.heading4",
    EditHeading5 => "edit.heading5",
    EditHeading6 => "edit.heading6",

    EditBlockquote => "edit.blockquote",
    EditBulletList => "edit.bullet_list",
    EditOrderedList => "edit.ordered_list",
    EditCodeBlock => "edit.code_block",
    EditHardBreak => "edit.hard_break",
    EditParagraph => "edit.paragraph",
    EditInsertImage => "edit.insert_image",

    ViewToggleSidebar => "view.toggle_sidebar",

    NavigationBack => "navigation.back",
    NavigationForward => "navigation.forward",

    CanvasNewText => "canvas.new_text",
    CanvasNewFile => "canvas.new_file",
    CanvasNewGroup => "canvas.new_group",
    CanvasZoomToFit => "canvas.zoom_to_fit",
    CanvasZoomToSelection => "canvas.zoom_to_selection",
    CanvasToggleSnap => "canvas.toggle_snap",
    CanvasToggleMinimap => "canvas.toggle_minimap",
}

impl CommandId {
    /// Canvas commands act on the focused board, and their keys work only
    /// while a board has focus, so they can be plain letters. The frontend
    /// dispatches them on every platform; the native menu never registers
    /// their accelerators, or macOS would claim `N` everywhere.
    pub fn is_canvas(self) -> bool {
        self.as_str().starts_with("canvas.")
    }
}

impl std::fmt::Display for CommandId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct CommandMeta {
    pub id: CommandId,
    pub label: String,
    /// The accelerator in effect: the compiled-in default, or the user's
    /// override when `is_overridden`.
    pub accelerator: Option<String>,
    pub is_overridden: bool,
}

/// The system file manager goes by a different name on every platform, and
/// the label has to be picked here rather than in the UI so the native menu,
/// the frontend menus and the keybindings pane all agree on one string.
fn reveal_in_system_label() -> &'static str {
    if cfg!(target_os = "macos") {
        "Reveal in Finder"
    } else if cfg!(target_os = "windows") {
        "Show in File Explorer"
    } else {
        "Show in File Manager"
    }
}

/// Commands the web app leaves out: it has no folder to open as a workspace
/// or import a vault into, and no file manager to show a file in.
pub const NOT_ON_WEB: [CommandId; 3] = [
    CommandId::FileOpenFolder,
    CommandId::FileImportFromSync,
    CommandId::FileRevealInSystem,
];

/// The web app's default where it differs. Browsers keep Ctrl/Cmd+N, T and W
/// (new window, new tab, close tab) for themselves, so those move to Alt.
fn web_accelerator(id: CommandId) -> Option<&'static str> {
    match id {
        CommandId::FileNewNote => Some("Alt+N"),
        CommandId::FileNewFolder => Some("Alt+Shift+N"),
        CommandId::FileNewTab => Some("Alt+T"),
        CommandId::FileCloseTab => Some("Alt+W"),
        _ => None,
    }
}

/// The registry as the web app has it: the browser's defaults, without the
/// commands it can't run.
pub fn web_commands() -> Vec<CommandMeta> {
    commands_labelled("Show in File Manager")
        .into_iter()
        .filter(|c| !NOT_ON_WEB.contains(&c.id))
        .map(|mut c| {
            if let Some(accelerator) = web_accelerator(c.id) {
                c.accelerator = Some(accelerator.into());
            }
            c
        })
        .collect()
}

pub fn default_commands() -> Vec<CommandMeta> {
    commands_labelled(reveal_in_system_label())
}

/// The registry with `reveal` as the file manager command's label. The web
/// app's copy uses a neutral one, so it's the same whatever exported it.
pub fn commands_labelled(reveal: &str) -> Vec<CommandMeta> {
    vec![
        // -- App --
        CommandMeta {
            id: CommandId::AppSettings,
            label: "Settings...".into(),
            accelerator: Some("CmdOrCtrl+,".into()),
            is_overridden: false,
        },
        // -- File --
        CommandMeta {
            id: CommandId::FileNewNote,
            label: "New Note".into(),
            accelerator: Some("CmdOrCtrl+N".into()),
            is_overridden: false,
        },
        CommandMeta {
            id: CommandId::FileNewCanvas,
            label: "New Canvas".into(),
            // No default: creating a board is a deliberate, occasional action,
            // and it stays bindable from the keybindings pane.
            accelerator: None,
            is_overridden: false,
        },
        CommandMeta {
            id: CommandId::FileNewFolder,
            label: "New Folder".into(),
            accelerator: Some("CmdOrCtrl+Alt+N".into()),
            is_overridden: false,
        },
        CommandMeta {
            id: CommandId::FileOpenFile,
            label: "Open File".into(),
            accelerator: Some("CmdOrCtrl+O".into()),
            is_overridden: false,
        },
        CommandMeta {
            id: CommandId::FileNewTab,
            label: "New Tab".into(),
            accelerator: Some("CmdOrCtrl+T".into()),
            is_overridden: false,
        },
        CommandMeta {
            id: CommandId::FileCloseTab,
            label: "Close Tab".into(),
            accelerator: Some("CmdOrCtrl+W".into()),
            is_overridden: false,
        },
        CommandMeta {
            id: CommandId::FileNewWorkspace,
            label: "New Workspace...".into(),
            accelerator: None,
            is_overridden: false,
        },
        CommandMeta {
            id: CommandId::FileImportFromSync,
            label: "Import from Sync...".into(),
            accelerator: None,
            is_overridden: false,
        },
        CommandMeta {
            id: CommandId::FileManageWorkspaces,
            label: "Manage Workspaces...".into(),
            accelerator: None,
            is_overridden: false,
        },
        CommandMeta {
            id: CommandId::FileOpenFolder,
            label: "Open Folder as Workspace...".into(),
            accelerator: Some("CmdOrCtrl+Shift+O".into()),
            is_overridden: false,
        },
        // -- Current file --
        // These act on whatever file the focused tab has open, so they carry
        // no default accelerator: the useful ones are per-user, and an empty
        // default keeps them bindable from the keybindings pane without
        // spending a keystroke everyone has to live with.
        CommandMeta {
            id: CommandId::FileRevealInExplorer,
            label: "Reveal in Explorer".into(),
            accelerator: None,
            is_overridden: false,
        },
        CommandMeta {
            id: CommandId::FileRevealInSystem,
            label: reveal.into(),
            accelerator: None,
            is_overridden: false,
        },
        CommandMeta {
            id: CommandId::FileOpenInDefaultApp,
            label: "Open in Default App".into(),
            accelerator: None,
            is_overridden: false,
        },
        CommandMeta {
            id: CommandId::FileCopyPath,
            label: "Copy Absolute Path".into(),
            accelerator: None,
            is_overridden: false,
        },
        CommandMeta {
            id: CommandId::FileCopyRelativePath,
            label: "Copy Relative Path".into(),
            accelerator: None,
            is_overridden: false,
        },
        CommandMeta {
            id: CommandId::FileCopyWikilink,
            label: "Copy Wikilink".into(),
            accelerator: None,
            is_overridden: false,
        },
        CommandMeta {
            id: CommandId::FileRename,
            label: "Rename...".into(),
            accelerator: Some("F2".into()),
            is_overridden: false,
        },
        CommandMeta {
            id: CommandId::FileDuplicate,
            label: "Duplicate".into(),
            accelerator: None,
            is_overridden: false,
        },
        CommandMeta {
            id: CommandId::FileMoveTo,
            label: "Move to...".into(),
            accelerator: None,
            is_overridden: false,
        },
        CommandMeta {
            id: CommandId::FileDelete,
            label: "Delete".into(),
            accelerator: None,
            is_overridden: false,
        },
        // -- Text formatting (commonmark) --
        CommandMeta {
            id: CommandId::EditBold,
            label: "Bold".into(),
            accelerator: Some("CmdOrCtrl+B".into()),
            is_overridden: false,
        },
        CommandMeta {
            id: CommandId::EditItalic,
            label: "Italic".into(),
            accelerator: Some("CmdOrCtrl+I".into()),
            is_overridden: false,
        },
        CommandMeta {
            id: CommandId::EditInlineCode,
            label: "Inline code".into(),
            accelerator: Some("CmdOrCtrl+E".into()),
            is_overridden: false,
        },
        CommandMeta {
            id: CommandId::EditStrikethrough,
            label: "Strikethrough".into(),
            accelerator: Some("CmdOrCtrl+Alt+X".into()),
            is_overridden: false,
        },
        // -- Editor --
        CommandMeta {
            id: CommandId::EditFind,
            label: "Find...".into(),
            accelerator: Some("CmdOrCtrl+F".into()),
            is_overridden: false,
        },
        // -- Headings (commonmark) --
        CommandMeta {
            id: CommandId::EditHeading1,
            label: "Heading 1".into(),
            accelerator: Some("CmdOrCtrl+Alt+1".into()),
            is_overridden: false,
        },
        CommandMeta {
            id: CommandId::EditHeading2,
            label: "Heading 2".into(),
            accelerator: Some("CmdOrCtrl+Alt+2".into()),
            is_overridden: false,
        },
        CommandMeta {
            id: CommandId::EditHeading3,
            label: "Heading 3".into(),
            accelerator: Some("CmdOrCtrl+Alt+3".into()),
            is_overridden: false,
        },
        CommandMeta {
            id: CommandId::EditHeading4,
            label: "Heading 4".into(),
            accelerator: Some("CmdOrCtrl+Alt+4".into()),
            is_overridden: false,
        },
        CommandMeta {
            id: CommandId::EditHeading5,
            label: "Heading 5".into(),
            accelerator: Some("CmdOrCtrl+Alt+5".into()),
            is_overridden: false,
        },
        CommandMeta {
            id: CommandId::EditHeading6,
            label: "Heading 6".into(),
            accelerator: Some("CmdOrCtrl+Alt+6".into()),
            is_overridden: false,
        },
        // -- Block elements (commonmark) --
        CommandMeta {
            id: CommandId::EditBlockquote,
            label: "Blockquote".into(),
            accelerator: Some("CmdOrCtrl+Shift+B".into()),
            is_overridden: false,
        },
        CommandMeta {
            id: CommandId::EditBulletList,
            label: "Bullet list".into(),
            accelerator: Some("CmdOrCtrl+Alt+8".into()),
            is_overridden: false,
        },
        CommandMeta {
            id: CommandId::EditOrderedList,
            label: "Ordered list".into(),
            accelerator: Some("CmdOrCtrl+Alt+7".into()),
            is_overridden: false,
        },
        CommandMeta {
            id: CommandId::EditCodeBlock,
            label: "Code block".into(),
            accelerator: Some("CmdOrCtrl+Alt+C".into()),
            is_overridden: false,
        },
        CommandMeta {
            id: CommandId::EditHardBreak,
            label: "Insert hard break".into(),
            accelerator: Some("Shift+Enter".into()),
            is_overridden: false,
        },
        CommandMeta {
            id: CommandId::EditParagraph,
            label: "Paragraph".into(),
            accelerator: Some("CmdOrCtrl+Alt+0".into()),
            is_overridden: false,
        },
        // No default accelerator: inserting an image is a deliberate, rare
        // action, and it stays bindable from the keybindings pane.
        CommandMeta {
            id: CommandId::EditInsertImage,
            label: "Insert image...".into(),
            accelerator: None,
            is_overridden: false,
        },
        // -- View --
        CommandMeta {
            id: CommandId::ViewToggleSidebar,
            label: "Toggle sidebar".into(),
            accelerator: Some("CmdOrCtrl+Shift+E".into()),
            is_overridden: false,
        },
        // -- Navigation --
        CommandMeta {
            id: CommandId::NavigationBack,
            label: "Go Back".into(),
            accelerator: Some("Alt+ArrowLeft".into()),
            is_overridden: false,
        },
        CommandMeta {
            id: CommandId::NavigationForward,
            label: "Go Forward".into(),
            accelerator: Some("Alt+ArrowRight".into()),
            is_overridden: false,
        },
        // -- Canvas --
        // These work only while a board has focus (see `is_canvas`), so
        // they can be single keys without stealing typing anywhere else. The
        // board's own keys -- Delete, Enter, the arrows, 0 and 1 -- stay in
        // its keydown handler, as the image viewer's 0 and 1 do.
        CommandMeta {
            id: CommandId::CanvasNewText,
            label: "New Card".into(),
            accelerator: Some("N".into()),
            is_overridden: false,
        },
        CommandMeta {
            id: CommandId::CanvasNewFile,
            label: "New File Card...".into(),
            accelerator: Some("F".into()),
            is_overridden: false,
        },
        CommandMeta {
            id: CommandId::CanvasNewGroup,
            label: "New Group".into(),
            accelerator: Some("CmdOrCtrl+G".into()),
            is_overridden: false,
        },
        CommandMeta {
            id: CommandId::CanvasZoomToFit,
            label: "Zoom to Fit".into(),
            accelerator: Some("Shift+1".into()),
            is_overridden: false,
        },
        CommandMeta {
            id: CommandId::CanvasZoomToSelection,
            label: "Zoom to Selection".into(),
            accelerator: Some("Shift+2".into()),
            is_overridden: false,
        },
        CommandMeta {
            id: CommandId::CanvasToggleSnap,
            label: "Snap to Grid".into(),
            accelerator: Some("CmdOrCtrl+'".into()),
            is_overridden: false,
        },
        CommandMeta {
            id: CommandId::CanvasToggleMinimap,
            label: "Show Minimap".into(),
            accelerator: Some("M".into()),
            is_overridden: false,
        },
    ]
}
#[cfg(test)]
mod web_tests {
    use super::*;

    #[test]
    fn the_web_keeps_the_browsers_keys_free() {
        let web = web_commands();
        let key = |id: CommandId| web.iter().find(|c| c.id == id).and_then(|c| c.accelerator.clone());
        assert_eq!(key(CommandId::FileNewNote).as_deref(), Some("Alt+N"));
        assert_eq!(key(CommandId::FileNewTab).as_deref(), Some("Alt+T"));
        assert_eq!(key(CommandId::FileCloseTab).as_deref(), Some("Alt+W"));
        for id in NOT_ON_WEB {
            assert!(web.iter().all(|c| c.id != id), "{id} is on the web");
        }
        // No browser-reserved accelerator is left anywhere.
        for c in &web {
            let a = c.accelerator.as_deref().unwrap_or_default();
            assert!(!["CmdOrCtrl+N", "CmdOrCtrl+T", "CmdOrCtrl+W"].contains(&a), "{} uses {a}", c.id);
        }
    }
}

#[cfg(test)]
mod canvas_tests {
    use super::*;

    #[test]
    fn every_canvas_command_has_a_key_of_its_own() {
        let commands = default_commands();
        let canvas: Vec<_> = commands.iter().filter(|c| c.id.is_canvas()).collect();
        assert_eq!(canvas.len(), 7);
        for c in &canvas {
            let key = c.accelerator.as_deref().unwrap_or_else(|| panic!("{} has no key", c.id));
            // A board key never shadows a global one, so either can be
            // rebound without the other changing meaning.
            assert!(
                commands.iter().all(|o| o.id == c.id || o.accelerator.as_deref() != Some(key)),
                "{} shares {key}",
                c.id
            );
        }
    }
}
