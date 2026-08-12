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
    };
}

command_id! {
    FileNew => "file.new",
    FileOpenFolder => "file.open_folder",

    EditBold => "edit.bold",
    EditItalic => "edit.italic",
    EditInlineCode => "edit.inline_code",
    EditStrikethrough => "edit.strikethrough",

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

    ViewToggleSidebar => "view.toggle_sidebar",

    NavigationBack => "navigation.back",
    NavigationForward => "navigation.forward",
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
    pub default_accelerator: Option<String>,
}

pub fn default_commands() -> Vec<CommandMeta> {
    vec![
        CommandMeta {
            id: CommandId::FileNew,
            label: "New note".into(),
            default_accelerator: Some("CmdOrCtrl+N".into()),
        },
        CommandMeta {
            id: CommandId::FileOpenFolder,
            label: "Open Folder".into(),
            default_accelerator: Some("CmdOrCtrl+Shift+O".into()),
        },
        // -- Text formatting (commonmark) --
        CommandMeta {
            id: CommandId::EditBold,
            label: "Bold".into(),
            default_accelerator: Some("CmdOrCtrl+B".into()),
        },
        CommandMeta {
            id: CommandId::EditItalic,
            label: "Italic".into(),
            default_accelerator: Some("CmdOrCtrl+I".into()),
        },
        CommandMeta {
            id: CommandId::EditInlineCode,
            label: "Inline code".into(),
            default_accelerator: Some("CmdOrCtrl+E".into()),
        },
        CommandMeta {
            id: CommandId::EditStrikethrough,
            label: "Strikethrough".into(),
            default_accelerator: Some("CmdOrCtrl+Alt+X".into()),
        },
        // -- Headings (commonmark) --
        CommandMeta {
            id: CommandId::EditHeading1,
            label: "Heading 1".into(),
            default_accelerator: Some("CmdOrCtrl+Alt+1".into()),
        },
        CommandMeta {
            id: CommandId::EditHeading2,
            label: "Heading 2".into(),
            default_accelerator: Some("CmdOrCtrl+Alt+2".into()),
        },
        CommandMeta {
            id: CommandId::EditHeading3,
            label: "Heading 3".into(),
            default_accelerator: Some("CmdOrCtrl+Alt+3".into()),
        },
        CommandMeta {
            id: CommandId::EditHeading4,
            label: "Heading 4".into(),
            default_accelerator: Some("CmdOrCtrl+Alt+4".into()),
        },
        CommandMeta {
            id: CommandId::EditHeading5,
            label: "Heading 5".into(),
            default_accelerator: Some("CmdOrCtrl+Alt+5".into()),
        },
        CommandMeta {
            id: CommandId::EditHeading6,
            label: "Heading 6".into(),
            default_accelerator: Some("CmdOrCtrl+Alt+6".into()),
        },
        // -- Block elements (commonmark) --
        CommandMeta {
            id: CommandId::EditBlockquote,
            label: "Blockquote".into(),
            default_accelerator: Some("CmdOrCtrl+Shift+B".into()),
        },
        CommandMeta {
            id: CommandId::EditBulletList,
            label: "Bullet list".into(),
            default_accelerator: Some("CmdOrCtrl+Alt+8".into()),
        },
        CommandMeta {
            id: CommandId::EditOrderedList,
            label: "Ordered list".into(),
            default_accelerator: Some("CmdOrCtrl+Alt+7".into()),
        },
        CommandMeta {
            id: CommandId::EditCodeBlock,
            label: "Code block".into(),
            default_accelerator: Some("CmdOrCtrl+Alt+C".into()),
        },
        CommandMeta {
            id: CommandId::EditHardBreak,
            label: "Insert hard break".into(),
            default_accelerator: Some("Shift+Enter".into()),
        },
        CommandMeta {
            id: CommandId::EditParagraph,
            label: "Paragraph".into(),
            default_accelerator: Some("CmdOrCtrl+Alt+0".into()),
        },
        // -- View --
        CommandMeta {
            id: CommandId::ViewToggleSidebar,
            label: "Toggle sidebar".into(),
            default_accelerator: Some("CmdOrCtrl+Shift+E".into()),
        },
        // -- Navigation --
        CommandMeta {
            id: CommandId::NavigationBack,
            label: "Go Back".into(),
            default_accelerator: Some("Alt+ArrowLeft".into()),
        },
        CommandMeta {
            id: CommandId::NavigationForward,
            label: "Go Forward".into(),
            default_accelerator: Some("Alt+ArrowRight".into()),
        }
    ]
}
