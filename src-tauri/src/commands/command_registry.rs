use serde::{ Deserialize, Serialize };
use specta::Type;

/// Every command's id lives here, once. Both `default_commands()` below
/// and `menu_layout.rs`'s declarative spec reference these constants
/// instead of raw string literals -- a typo in either place becomes a
/// compile error (unresolved identifier) instead of a silently-missing
/// menu item or an unbindable command.
///
/// Undo/Redo/Cut/Copy/Paste/Select All are deliberately NOT here -- they
/// stayed as menu_layout.rs's `NativeItem`, not CommandMeta. They're
/// OS-conventional (Cmd+C etc.), already handled natively by the
/// browser/ProseMirror with zero JS involved, and were never meant to
/// be rebindable, so they never belonged in the same registry as things
/// like Bold that genuinely need a custom accelerator + handler.
pub mod command_ids {
    pub const FILE_NEW: &str = "file.new";
    pub const FILE_OPEN_FOLDER: &str = "file.open_folder";

    pub const EDIT_BOLD: &str = "edit.bold";
    pub const EDIT_ITALIC: &str = "edit.italic";
    pub const EDIT_INLINE_CODE: &str = "edit.inline_code";
    pub const EDIT_STRIKETHROUGH: &str = "edit.strikethrough";

    pub const EDIT_HEADING1: &str = "edit.heading1";
    pub const EDIT_HEADING2: &str = "edit.heading2";
    pub const EDIT_HEADING3: &str = "edit.heading3";
    pub const EDIT_HEADING4: &str = "edit.heading4";
    pub const EDIT_HEADING5: &str = "edit.heading5";
    pub const EDIT_HEADING6: &str = "edit.heading6";

    pub const EDIT_BLOCKQUOTE: &str = "edit.blockquote";
    pub const EDIT_BULLET_LIST: &str = "edit.bullet_list";
    pub const EDIT_ORDERED_LIST: &str = "edit.ordered_list";
    pub const EDIT_CODE_BLOCK: &str = "edit.code_block";
    pub const EDIT_HARD_BREAK: &str = "edit.hard_break";
    pub const EDIT_PARAGRAPH: &str = "edit.paragraph";

    pub const VIEW_TOGGLE_SIDEBAR: &str = "view.toggle_sidebar";
}

use command_ids::*;

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct CommandMeta {
    pub id: String,
    pub label: String,
    pub default_accelerator: Option<String>,
}

pub fn default_commands() -> Vec<CommandMeta> {
    vec![
        CommandMeta {
            id: FILE_NEW.into(),
            label: "New note".into(),
            default_accelerator: Some("CmdOrCtrl+N".into()),
        },
        CommandMeta {
            id: FILE_OPEN_FOLDER.into(),
            label: "Open Folder".into(),
            default_accelerator: Some("CmdOrCtrl+Shift+O".into()),
        },
        // -- Text formatting (commonmark) --
        CommandMeta {
            id: EDIT_BOLD.into(),
            label: "Bold".into(),
            default_accelerator: Some("CmdOrCtrl+B".into()),
        },
        CommandMeta {
            id: EDIT_ITALIC.into(),
            label: "Italic".into(),
            default_accelerator: Some("CmdOrCtrl+I".into()),
        },
        CommandMeta {
            id: EDIT_INLINE_CODE.into(),
            label: "Inline code".into(),
            default_accelerator: Some("CmdOrCtrl+E".into()),
        },
        CommandMeta {
            id: EDIT_STRIKETHROUGH.into(),
            label: "Strikethrough".into(),
            default_accelerator: Some("CmdOrCtrl+Alt+X".into()),
        },
        // -- Headings (commonmark) --
        CommandMeta {
            id: EDIT_HEADING1.into(),
            label: "Heading 1".into(),
            default_accelerator: Some("CmdOrCtrl+Alt+1".into()),
        },
        CommandMeta {
            id: EDIT_HEADING2.into(),
            label: "Heading 2".into(),
            default_accelerator: Some("CmdOrCtrl+Alt+2".into()),
        },
        CommandMeta {
            id: EDIT_HEADING3.into(),
            label: "Heading 3".into(),
            default_accelerator: Some("CmdOrCtrl+Alt+3".into()),
        },
        CommandMeta {
            id: EDIT_HEADING4.into(),
            label: "Heading 4".into(),
            default_accelerator: Some("CmdOrCtrl+Alt+4".into()),
        },
        CommandMeta {
            id: EDIT_HEADING5.into(),
            label: "Heading 5".into(),
            default_accelerator: Some("CmdOrCtrl+Alt+5".into()),
        },
        CommandMeta {
            id: EDIT_HEADING6.into(),
            label: "Heading 6".into(),
            default_accelerator: Some("CmdOrCtrl+Alt+6".into()),
        },
        // -- Block elements (commonmark) --
        CommandMeta {
            id: EDIT_BLOCKQUOTE.into(),
            label: "Blockquote".into(),
            default_accelerator: Some("CmdOrCtrl+Shift+B".into()),
        },
        CommandMeta {
            id: EDIT_BULLET_LIST.into(),
            label: "Bullet list".into(),
            default_accelerator: Some("CmdOrCtrl+Alt+8".into()),
        },
        CommandMeta {
            id: EDIT_ORDERED_LIST.into(),
            label: "Ordered list".into(),
            default_accelerator: Some("CmdOrCtrl+Alt+7".into()),
        },
        CommandMeta {
            id: EDIT_CODE_BLOCK.into(),
            label: "Code block".into(),
            default_accelerator: Some("CmdOrCtrl+Alt+C".into()),
        },
        CommandMeta {
            id: EDIT_HARD_BREAK.into(),
            label: "Insert hard break".into(),
            default_accelerator: Some("Shift+Enter".into()),
        },
        CommandMeta {
            id: EDIT_PARAGRAPH.into(),
            label: "Paragraph".into(),
            default_accelerator: Some("CmdOrCtrl+Alt+0".into()),
        },
        // -- View --
        CommandMeta {
            id: VIEW_TOGGLE_SIDEBAR.into(),
            label: "Toggle sidebar".into(),
            default_accelerator: Some("CmdOrCtrl+Shift+E".into()),
        }
        // ...rest of your commands
    ]
}
