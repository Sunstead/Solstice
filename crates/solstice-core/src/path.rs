//! Vault-relative paths: forward slashes, no `.`/`..`, never absolute.

use std::fmt;

/// Extensions a link may leave off (`[[todo]]` for `todo.md`). Mirrors
/// `FILE_TYPE_PRESETS` in the desktop app.
pub const IMPLICIT_EXTENSIONS: &[&str] = &["md", "canvas", "pdf"];

/// A path inside a vault, relative to its root, with `/` separators.
///
/// It can't climb out of the vault (`..`), be absolute or carry a drive
/// letter, so joining it onto a vault root always stays inside that root
/// (symlinks aside, which whoever touches the disk must check).
#[derive(Clone, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct VaultPath(String);

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum VaultPathError {
    Empty,
    Absolute,
    /// A `.` or `..` segment.
    Relative,
    /// A NUL or other control character.
    InvalidCharacter,
}

impl fmt::Display for VaultPathError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Self::Empty => "the path is empty",
            Self::Absolute => "the path must be relative to the vault",
            Self::Relative => "the path can't contain `.` or `..`",
            Self::InvalidCharacter => "the path contains a control character",
        })
    }
}

impl std::error::Error for VaultPathError {}

impl VaultPath {
    /// Accepts `\` or `/`, collapses repeated separators and drops a trailing
    /// one. Leading `/`, `\` or a drive letter make it absolute, and so invalid.
    pub fn parse(raw: &str) -> Result<Self, VaultPathError> {
        if raw.chars().any(char::is_control) {
            return Err(VaultPathError::InvalidCharacter);
        }
        let unified = raw.replace('\\', "/");
        if unified.starts_with('/') || has_drive_letter(&unified) {
            return Err(VaultPathError::Absolute);
        }
        let mut segments = Vec::new();
        for segment in unified.split('/') {
            match segment {
                "" => continue,
                "." | ".." => return Err(VaultPathError::Relative),
                s => segments.push(s),
            }
        }
        if segments.is_empty() {
            return Err(VaultPathError::Empty);
        }
        Ok(Self(segments.join("/")))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }

    pub fn segments(&self) -> impl Iterator<Item = &str> {
        self.0.split('/')
    }

    /// The last segment, extension included.
    pub fn file_name(&self) -> &str {
        self.0.rsplit('/').next().unwrap_or(&self.0)
    }

    /// The containing folder, or `None` at the vault root.
    pub fn parent(&self) -> Option<VaultPath> {
        self.0.rfind('/').map(|i| Self(self.0[..i].to_string()))
    }

    /// True if any segment starts with `.`: tooling state (`.solstice`,
    /// `.git`, `.obsidian`) that is never a note.
    pub fn is_hidden(&self) -> bool {
        is_hidden(&self.0)
    }

    pub fn extension(&self) -> Option<&str> {
        let name = self.file_name();
        match name.rfind('.') {
            Some(0) | None => None,
            Some(i) => Some(&name[i + 1..]),
        }
    }
}

impl fmt::Display for VaultPath {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

impl AsRef<str> for VaultPath {
    fn as_ref(&self) -> &str {
        &self.0
    }
}

fn has_drive_letter(path: &str) -> bool {
    let bytes = path.as_bytes();
    bytes.len() >= 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':'
}

/// True if any `/`-separated segment starts with `.`.
pub fn is_hidden(path: &str) -> bool {
    path.split('/')
        .any(|s| s.starts_with('.') && s != "." && s != "..")
}

/// Drops an implicit extension from the file name, keeping folders:
/// `notes/todo.md` → `notes/todo`, `photo.png` unchanged.
pub fn strip_implicit_extension(path: &str) -> &str {
    let name_start = path.rfind('/').map_or(0, |i| i + 1);
    let name = &path[name_start..];
    match name.rfind('.') {
        Some(dot) if dot > 0 && IMPLICIT_EXTENSIONS.contains(&&name[dot + 1..]) => {
            &path[..name_start + dot]
        }
        _ => path,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_and_normalizes() {
        assert_eq!(
            VaultPath::parse("notes\\todo.md").unwrap().as_str(),
            "notes/todo.md"
        );
        assert_eq!(
            VaultPath::parse("notes//sub/").unwrap().as_str(),
            "notes/sub"
        );
        assert_eq!(VaultPath::parse("Todo.md").unwrap().file_name(), "Todo.md");
    }

    #[test]
    fn refuses_paths_out_of_the_vault() {
        assert_eq!(VaultPath::parse("../x.md"), Err(VaultPathError::Relative));
        assert_eq!(VaultPath::parse("a/./b.md"), Err(VaultPathError::Relative));
        assert_eq!(
            VaultPath::parse("/etc/passwd"),
            Err(VaultPathError::Absolute)
        );
        assert_eq!(
            VaultPath::parse("\\\\server\\share"),
            Err(VaultPathError::Absolute)
        );
        assert_eq!(
            VaultPath::parse("C:/win.ini"),
            Err(VaultPathError::Absolute)
        );
        assert_eq!(VaultPath::parse(""), Err(VaultPathError::Empty));
        assert_eq!(VaultPath::parse("//"), Err(VaultPathError::Absolute));
        assert_eq!(
            VaultPath::parse("a\0b"),
            Err(VaultPathError::InvalidCharacter)
        );
    }

    #[test]
    fn knows_its_parts() {
        let p = VaultPath::parse("notes/sub/todo.md").unwrap();
        assert_eq!(p.parent().unwrap().as_str(), "notes/sub");
        assert_eq!(VaultPath::parse("todo.md").unwrap().parent(), None);
        assert_eq!(p.extension(), Some("md"));
        assert_eq!(VaultPath::parse(".gitignore").unwrap().extension(), None);
        assert!(VaultPath::parse(".solstice/settings.json")
            .unwrap()
            .is_hidden());
        assert!(VaultPath::parse("notes/.obsidian/x").unwrap().is_hidden());
        assert!(!p.is_hidden());
    }

    #[test]
    fn strips_only_implicit_extensions() {
        assert_eq!(strip_implicit_extension("notes/todo.md"), "notes/todo");
        assert_eq!(strip_implicit_extension("board.canvas"), "board");
        assert_eq!(strip_implicit_extension("paper.pdf"), "paper");
        assert_eq!(strip_implicit_extension("photo.png"), "photo.png");
        assert_eq!(strip_implicit_extension("v1.2/notes"), "v1.2/notes");
        assert_eq!(strip_implicit_extension(".md"), ".md");
    }
}
