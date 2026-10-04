//! The wire protocol: y-sync's step 1, step 2 and update, per document,
//! batched into frames for one vault. Frames are `postcard`-encoded and sent
//! as binary WebSocket messages.

use serde::{Deserialize, Serialize};

use crate::manifest::FileId;
use crate::Error;

/// Bumped on any incompatible change; a peer refuses other versions.
pub const PROTOCOL: u16 = 1;

/// Which document a message is about.
#[derive(Clone, Debug, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
pub enum DocKey {
    Manifest,
    Note(FileId),
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum Body {
    /// "This is what I have" (a state vector): reply with what I'm missing.
    Step1 { sv: Vec<u8> },
    /// What the other side was missing. `sv`, when present, is the sender's
    /// state vector: reply with a `Step2` of what the sender is missing.
    Step2 {
        update: Vec<u8>,
        sv: Option<Vec<u8>>,
    },
    /// A change made while connected.
    Update { update: Vec<u8> },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Msg {
    pub doc: DocKey,
    /// The sender's epoch for this document (see `docs/sync.md`).
    pub epoch: u32,
    pub body: Body,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Frame {
    pub v: u16,
    pub vault: String,
    pub msgs: Vec<Msg>,
}

impl Frame {
    pub fn new(vault: impl Into<String>, msgs: Vec<Msg>) -> Self {
        Self {
            v: PROTOCOL,
            vault: vault.into(),
            msgs,
        }
    }

    pub fn encode(&self) -> Vec<u8> {
        postcard::to_stdvec(self).expect("frames always serialize")
    }

    pub fn decode(bytes: &[u8]) -> Result<Self, Error> {
        // The version comes first, so it can be checked before the rest.
        let (v, _): (u16, _) =
            postcard::take_from_bytes(bytes).map_err(|e| Error::Decode(e.to_string()))?;
        if v != PROTOCOL {
            return Err(Error::Protocol(v));
        }
        postcard::from_bytes(bytes).map_err(|e| Error::Decode(e.to_string()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips() {
        let frame = Frame::new(
            "vault-1",
            vec![
                Msg {
                    doc: DocKey::Manifest,
                    epoch: 0,
                    body: Body::Step1 { sv: vec![0] },
                },
                Msg {
                    doc: DocKey::Note("abc".into()),
                    epoch: 2,
                    body: Body::Step2 {
                        update: vec![1, 2, 3],
                        sv: Some(vec![4]),
                    },
                },
            ],
        );
        assert_eq!(Frame::decode(&frame.encode()).unwrap(), frame);
    }

    #[test]
    fn refuses_other_versions() {
        let mut frame = Frame::new("v", vec![]);
        frame.v = PROTOCOL + 1;
        let bytes = postcard::to_stdvec(&frame).unwrap();
        assert!(matches!(Frame::decode(&bytes), Err(Error::Protocol(v)) if v == PROTOCOL + 1));
    }
}
