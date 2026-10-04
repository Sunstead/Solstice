//! A device's side of Solstice Sync: link a folder to a vault ([`link`]),
//! then keep them in sync ([`Client`]). The desktop app wraps this with
//! sign-in and its UI; iOS will too. Design: `docs/sync.md`.
//!
//! - Files are the truth on the device as on the server; sync state lives in
//!   `<folder>/.solstice/sync/` and can be rebuilt by linking again.
//! - Saves from an open editor go through a copy of the note that mirrors
//!   exactly what the editor holds ([`Client::editor_opened`],
//!   [`Client::saved`]), so they merge as concurrent edits and never revert
//!   changes that arrived meanwhile.

mod client;
mod link;
mod net;
mod store;

pub use client::{Client, ReviewInfo, Status, Versions};
pub use link::{link, unlink, LinkReport};
pub use net::{AuthInfo, NoTokens, Server, ServerInfo, TokenSource, VaultInfo};
pub use store::{is_linked, read_link, Link, OWN};

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("this folder isn't linked to a vault")]
    NotLinked,
    #[error("this folder is already linked to a vault; unlink it first")]
    AlreadyLinked,
    #[error("sign in to the sync server")]
    SignedOut,
    #[error("{0}")]
    NotFound(String),
    #[error("the sync server said: {message}")]
    Server { status: u16, message: String },
    #[error("can't reach the sync server: {0}")]
    Network(String),
    #[error("that isn't a sync server: {0}")]
    BadServer(String),
    #[error("{0}")]
    Io(String),
    #[error("sync state: {0}")]
    Store(String),
    #[error("{0}")]
    Sync(#[from] solstice_sync::Error),
    #[error("the vault was rebuilt on the server; link this folder again")]
    Relink,
    #[error("the sync client has stopped")]
    Stopped,
}

impl Error {
    pub(crate) fn io(e: impl std::fmt::Display) -> Self {
        Error::Io(e.to_string())
    }

    pub(crate) fn store(e: impl std::fmt::Display) -> Self {
        Error::Store(e.to_string())
    }
}

/// rustls needs one crypto provider for the process; reqwest and the
/// WebSocket client can bring different ones, so pick ours explicitly.
pub(crate) fn install_crypto() {
    let _ = rustls::crypto::ring::default_provider().install_default();
}
