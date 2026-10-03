//! The note model Solstice's desktop app, Solstice Sync and Atlas share:
//! vault-relative paths, wikilinks and their resolution, and front matter.
//!
//! Pure Rust with no I/O, so the server, the Tauri side and tests can all use
//! it. Wikilink behaviour mirrors the desktop app's TypeScript
//! (`apps/desktop/src/lib/wikilink/target.ts` and
//! `apps/desktop/src/lib/stores/wikilink-index.ts`); the tests here and there
//! cover the same cases, and a change to one needs the other.

pub mod markdown;
pub mod path;
pub mod wikilink;

pub use markdown::{split_front_matter, title, FrontMatter};
pub use path::{
    is_hidden, strip_implicit_extension, VaultPath, VaultPathError, IMPLICIT_EXTENSIONS,
};
pub use wikilink::{
    find_wikilinks, normalize_target, parse_target, Resolution, WikilinkIndex, WikilinkMatch,
    WikilinkParts,
};
