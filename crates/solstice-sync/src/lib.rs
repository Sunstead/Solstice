//! Solstice Sync's engine, shared by the server, the desktop app and (later)
//! iOS. No I/O: callers own the transport, storage and files. Design and
//! decisions: `docs/sync.md`.
//!
//! - [`NoteDoc`]: one note's markdown as a Yjs text, with history.
//! - [`Manifest`]: which files a vault has, by stable id, plus reviews.
//! - [`Vault`]: one replica, with the local operations that produce
//!   messages for peers.
//! - [`Session`]: the sync protocol for one connection, either end.
//! - [`plan_link`]: what to do the first time a folder meets a vault.

pub mod diff;
pub mod link;
pub mod manifest;
pub mod note;
pub mod overlap;
pub mod protocol;
pub mod session;
pub mod vault;

pub use link::{plan_link, LinkStep, LocalFile};
pub use manifest::{Deleted, Entry, FileId, Kind, Manifest, Review, ReviewKind};
pub use note::{decode_snapshot, encode_snapshot, NoteDoc};
pub use overlap::overlaps;
pub use protocol::{Body, DocKey, Frame, Msg, PROTOCOL};
pub use session::{Event, Outcome, Role, Session};
pub use vault::{content_hash, is_content_hash, Content, Vault};
pub use yrs::Snapshot;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("couldn't decode: {0}")]
    Decode(String),
    #[error("couldn't rebuild an earlier version: {0}")]
    History(String),
    #[error("protocol version {0} isn't supported")]
    Protocol(u16),
    #[error("no file with id {0}")]
    UnknownFile(String),
    #[error("bad path: {0}")]
    Path(#[from] solstice_core::VaultPathError),
    #[error("{0} is hidden, and hidden files don't sync")]
    Hidden(String),
}
