//! Full-text search of a workspace folder.
//!
//! - [`extract`] reads what's searchable from a file: a note's text (its
//!   `%%comments%%` aside), a canvas's cards, a PDF's pages and the
//!   handwriting recognised in its marks, a drawing's handwriting.
//! - [`Index`] keeps that per file, and on [`Index::refresh`] reads again
//!   only what changed (by size and modification time), with a cache on disk
//!   so a reopened workspace starts warm.
//! - [`query`] finds a literal string in it, with the find bar's case and
//!   whole-word rules, and says where each hit is for the editor to jump to.
//!
//! No I/O beyond the folder and the cache, and nothing of Tauri's: the app
//! runs it on the workspace, Solstice Sync on each vault's folder.

pub mod extract;
pub mod index;
pub mod query;

pub use extract::{extract, kind_of, Doc, Kind, Place, Segment};
pub use index::{Index, RefreshStats};
pub use query::{search, FileHits, Hit, Jump, Limits, Query, Results};
