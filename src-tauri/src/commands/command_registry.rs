use serde::{ Deserialize, Serialize };
use specta::Type;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "lowercase")]
pub enum CommandGroup {
    File,
    Edit,
    View,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct CommandMeta {
    pub id: String,
    pub label: String,
    pub group: CommandGroup,
    pub default_accelerator: Option<String>,
}

pub fn default_commands() -> Vec<CommandMeta> {
    vec![
        CommandMeta {
            id: "file.new".into(),
            label: "New note".into(),
            group: CommandGroup::File,
            default_accelerator: Some("CmdOrCtrl+N".into()),
        },
        CommandMeta {
            id: "edit.bold".into(),
            label: "Bold".into(),
            group: CommandGroup::Edit,
            default_accelerator: Some("CmdOrCtrl+B".into()),
        },
        CommandMeta {
            id: "view.toggle_sidebar".into(),
            label: "Toggle sidebar".into(),
            group: CommandGroup::View,
            default_accelerator: Some("CmdOrCtrl+Shift+E".into()),
        },
        // -- Text formatting (commonmark) --
        CommandMeta {
            id: "edit.italic".into(),
            label: "Italic".into(),
            group: CommandGroup::Edit,
            default_accelerator: Some("CmdOrCtrl+I".into()),
        },
        CommandMeta {
            id: "edit.inline_code".into(),
            label: "Inline code".into(),
            group: CommandGroup::Edit,
            default_accelerator: Some("CmdOrCtrl+E".into()),
        },
        // -- Headings (commonmark) --
        CommandMeta {
            id: "edit.heading1".into(),
            label: "Heading 1".into(),
            group: CommandGroup::Edit,
            default_accelerator: Some("CmdOrCtrl+Alt+1".into()),
        },
        CommandMeta {
            id: "edit.heading2".into(),
            label: "Heading 2".into(),
            group: CommandGroup::Edit,
            default_accelerator: Some("CmdOrCtrl+Alt+2".into()),
        },
        CommandMeta {
            id: "edit.heading3".into(),
            label: "Heading 3".into(),
            group: CommandGroup::Edit,
            default_accelerator: Some("CmdOrCtrl+Alt+3".into()),
        },
        CommandMeta {
            id: "edit.heading4".into(),
            label: "Heading 4".into(),
            group: CommandGroup::Edit,
            default_accelerator: Some("CmdOrCtrl+Alt+4".into()),
        },
        CommandMeta {
            id: "edit.heading5".into(),
            label: "Heading 5".into(),
            group: CommandGroup::Edit,
            default_accelerator: Some("CmdOrCtrl+Alt+5".into()),
        },
        CommandMeta {
            id: "edit.heading6".into(),
            label: "Heading 6".into(),
            group: CommandGroup::Edit,
            default_accelerator: Some("CmdOrCtrl+Alt+6".into()),
        },
        // -- Block elements (commonmark) --
        CommandMeta {
            id: "edit.blockquote".into(),
            label: "Blockquote".into(),
            group: CommandGroup::Edit,
            default_accelerator: Some("CmdOrCtrl+Shift+B".into()),
        },
        CommandMeta {
            id: "edit.bullet_list".into(),
            label: "Bullet list".into(),
            group: CommandGroup::Edit,
            default_accelerator: Some("CmdOrCtrl+Alt+8".into()),
        },
        CommandMeta {
            id: "edit.ordered_list".into(),
            label: "Ordered list".into(),
            group: CommandGroup::Edit,
            default_accelerator: Some("CmdOrCtrl+Alt+7".into()),
        },
        CommandMeta {
            id: "edit.code_block".into(),
            label: "Code block".into(),
            group: CommandGroup::Edit,
            default_accelerator: Some("CmdOrCtrl+Alt+C".into()),
        },
        CommandMeta {
            id: "edit.hard_break".into(),
            label: "Insert hard break".into(),
            group: CommandGroup::Edit,
            default_accelerator: Some("Shift+Enter".into()),
        },
        CommandMeta {
            id: "edit.paragraph".into(),
            label: "Turn into paragraph".into(),
            group: CommandGroup::Edit,
            default_accelerator: Some("CmdOrCtrl+Alt+0".into()),
        },
        // -- GFM --
        CommandMeta {
            id: "edit.strikethrough".into(),
            label: "Strikethrough".into(),
            group: CommandGroup::Edit,
            default_accelerator: Some("CmdOrCtrl+Alt+X".into()),
        }
        // ...rest of your commands
    ]
}
