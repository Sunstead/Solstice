//! One note as a Yjs document: a `Y.Text` named `md` holding the raw
//! markdown, with history kept so earlier versions can be read back.

use yrs::block::ClientID;
use yrs::types::text::{ChangeKind, Diff, YChange};
use yrs::updates::decoder::Decode;
use yrs::updates::encoder::{Encode, Encoder, EncoderV1};
use yrs::{
    Any, Doc, GetString, OffsetKind, Options, Out, ReadTxn, Snapshot, StateVector, Text, TextRef,
    Transact, Update,
};

use crate::diff;
use crate::Error;

const TEXT: &str = "md";

/// A Yjs document with history: `skip_gc`, so deleted text stays in the
/// store and [`Snapshot`]s can be read back. Offsets are UTF-16 units, as in
/// Yjs itself, so a JavaScript editor binding can share them later.
pub(crate) fn new_doc(client: Option<ClientID>) -> Doc {
    let mut options = Options::with_client_id(client.unwrap_or_else(ClientID::random));
    options.offset_kind = OffsetKind::Utf16;
    options.skip_gc = true;
    Doc::with_options(options)
}

pub(crate) fn decode_update(bytes: &[u8]) -> Result<Update, Error> {
    Update::decode_v1(bytes).map_err(|e| Error::Decode(e.to_string()))
}

pub(crate) fn apply(doc: &Doc, update: &[u8]) -> Result<(), Error> {
    let update = decode_update(update)?;
    doc.transact_mut()
        .apply_update(update)
        .map_err(|e| Error::Decode(e.to_string()))
}

/// The document as it was at `snapshot`, as a new document. Only for maps
/// (the manifest): yrs 0.28 can encode a text snapshot that it can't decode
/// when the snapshot ends inside a merged block, so text uses
/// [`NoteDoc::text_at`], which reads the live document instead.
pub(crate) fn doc_at(doc: &Doc, snapshot: &Snapshot) -> Result<Doc, Error> {
    let txn = doc.transact();
    // A peer's snapshot can count changes this document holds only as
    // pending (they arrived before what they depend on); yrs panics if asked
    // to encode past what it has integrated, so stop there.
    let have = txn.state_vector();
    let mut sv = StateVector::default();
    for (client, clock) in snapshot.state_map.iter() {
        let clock = (*clock).min(have.get(client));
        if clock > 0 {
            sv.set_max(*client, clock);
        }
    }
    let snapshot = Snapshot::new(sv, snapshot.delete_set.clone());
    let mut encoder = EncoderV1::new();
    txn.encode_state_from_snapshot(&snapshot, &mut encoder)
        .map_err(|e| Error::History(e.to_string()))?;
    drop(txn);
    let past = new_doc(None);
    apply(&past, &encoder.to_vec())?;
    Ok(past)
}

pub fn encode_snapshot(snapshot: &Snapshot) -> Vec<u8> {
    snapshot.encode_v1()
}

pub fn decode_snapshot(bytes: &[u8]) -> Result<Snapshot, Error> {
    Snapshot::decode_v1(bytes).map_err(|e| Error::Decode(e.to_string()))
}

pub(crate) fn decode_state_vector(bytes: &[u8]) -> Result<StateVector, Error> {
    StateVector::decode_v1(bytes).map_err(|e| Error::Decode(e.to_string()))
}

fn utf16_len(s: &str) -> u32 {
    s.encode_utf16().count() as u32
}

/// A run of the text, comparing now with an earlier snapshot.
#[derive(Debug, PartialEq, Eq)]
enum Run {
    /// In both.
    Same(String),
    /// Only now: added since.
    Added(String),
    /// Only then: removed since.
    Removed(String),
}

fn chunk_text(diff: &Diff<YChange>) -> String {
    match &diff.insert {
        Out::Any(Any::String(s)) => s.to_string(),
        _ => String::new(),
    }
}

/// A note's text as a CRDT. Cheap to keep many of.
pub struct NoteDoc {
    doc: Doc,
    text: TextRef,
    /// Bumped by the server when it had to rebuild this note from its file;
    /// histories from different epochs never merge.
    pub epoch: u32,
}

impl NoteDoc {
    pub fn new(epoch: u32) -> Self {
        let doc = new_doc(None);
        let text = doc.get_or_insert_text(TEXT);
        Self { doc, text, epoch }
    }

    /// A note whose first content is `text`.
    pub fn with_text(text: &str, epoch: u32) -> Self {
        let note = Self::new(epoch);
        note.apply_save(text, None)
            .expect("a new note has no history to read");
        note
    }

    /// A note from [`NoteDoc::encode_state`].
    pub fn load(state: &[u8], epoch: u32) -> Result<Self, Error> {
        let note = Self::new(epoch);
        apply(&note.doc, state)?;
        Ok(note)
    }

    pub fn text(&self) -> String {
        self.text.get_string(&self.doc.transact())
    }

    pub fn snapshot(&self) -> Snapshot {
        self.doc.transact().snapshot()
    }

    pub fn state_vector(&self) -> Vec<u8> {
        self.doc.transact().state_vector().encode_v1()
    }

    /// Everything, for storage or a peer that has nothing.
    pub fn encode_state(&self) -> Vec<u8> {
        self.doc
            .transact()
            .encode_state_as_update_v1(&StateVector::default())
    }

    /// What a peer at `state_vector` is missing. Carries this side's whole
    /// delete set, which is what lets the receiver read this side's text.
    pub fn encode_diff(&self, state_vector: &[u8]) -> Result<Vec<u8>, Error> {
        let sv = decode_state_vector(state_vector)?;
        Ok(self.doc.transact().encode_diff_v1(&sv))
    }

    pub fn apply_update(&self, update: &[u8]) -> Result<(), Error> {
        apply(&self.doc, update)
    }

    /// The text as it was at `snapshot`. Any snapshot of this document's
    /// history works, including ones made up from parts of two (the common
    /// base of a merge).
    pub fn text_at(&self, snapshot: &Snapshot) -> Result<String, Error> {
        let mut txn = self.doc.transact_mut();
        let chunks = self
            .text
            .diff_range(&mut txn, Some(snapshot), None, YChange::identity);
        Ok(chunks.iter().map(chunk_text).collect())
    }

    /// The text now, run by run against `then`.
    fn runs_since(&self, then: &Snapshot) -> Vec<Run> {
        let mut txn = self.doc.transact_mut();
        let now = txn.snapshot();
        let chunks = self
            .text
            .diff_range(&mut txn, Some(&now), Some(then), YChange::identity);
        chunks
            .iter()
            .filter_map(|c| {
                let s = chunk_text(c);
                (!s.is_empty()).then(|| match c.ychange.as_ref().map(|y| &y.kind) {
                    Some(ChangeKind::Added) => Run::Added(s),
                    Some(ChangeKind::Removed) => Run::Removed(s),
                    None => Run::Same(s),
                })
            })
            .collect()
    }

    /// Applies a file save. `base` is the snapshot the saved text was edited
    /// from (what the editor loaded); `None` means "the current text".
    ///
    /// When changes arrived after `base`, the save is diffed against the base
    /// text, and each change is carried through history to where that text
    /// is now: deleted base text is deleted where it still exists, and text
    /// added since by others is left alone. So a save from a stale buffer adds
    /// the user's edits without reverting anyone else's.
    ///
    /// Returns the update to send to peers, or `None` if nothing changed.
    pub fn apply_save(&self, new: &str, base: Option<&Snapshot>) -> Result<Option<Vec<u8>>, Error> {
        let current = self.text();
        let ops = match base.filter(|b| **b != self.snapshot()) {
            Some(base) => {
                let runs = self.runs_since(base);
                let base_text: String = runs
                    .iter()
                    .filter_map(|r| match r {
                        Run::Same(s) | Run::Removed(s) => Some(s.as_str()),
                        Run::Added(_) => None,
                    })
                    .collect();
                if base_text == new {
                    return Ok(None);
                }
                carry_over(&runs, &diff::hunks(&base_text, new))
            }
            None => {
                if current == new {
                    return Ok(None);
                }
                diff::hunks(&current, new)
                    .into_iter()
                    .map(|h| Op {
                        delete: vec![h.old.clone()],
                        at: h.old.start,
                        insert: h.insert,
                    })
                    .collect()
            }
        };
        Ok(Some(self.apply_ops(&current, ops)))
    }

    /// Applies ops given in byte offsets of `current` (this doc's text).
    fn apply_ops(&self, current: &str, mut ops: Vec<Op>) -> Vec<u8> {
        // Last first, so earlier offsets stay valid.
        ops.sort_by_key(|op| std::cmp::Reverse(op.at));
        let mut txn = self.doc.transact_mut();
        for op in ops {
            let mut deletes = op.delete;
            deletes.sort_by_key(|r| std::cmp::Reverse(r.start));
            for range in deletes.into_iter().filter(|r| !r.is_empty()) {
                let at = utf16_len(&current[..range.start]);
                let len = utf16_len(&current[range]);
                self.text.remove_range(&mut txn, at, len);
            }
            if !op.insert.is_empty() {
                self.text
                    .insert(&mut txn, utf16_len(&current[..op.at]), &op.insert);
            }
        }
        txn.encode_update_v1()
    }
}

/// One change in byte offsets of the current text: delete these ranges,
/// then insert at `at` (which is at or before every deleted range).
#[derive(Debug)]
struct Op {
    delete: Vec<std::ops::Range<usize>>,
    at: usize,
    insert: String,
}

/// Turns hunks against the base text into ops on the current text, using
/// the runs that relate the two.
fn carry_over(runs: &[Run], hunks: &[diff::Hunk]) -> Vec<Op> {
    // Each run's place in the base text and in the current text.
    struct Seg {
        base: std::ops::Range<usize>,
        cur: std::ops::Range<usize>,
        same: bool,
    }
    let mut segs = Vec::with_capacity(runs.len());
    let (mut b, mut c) = (0, 0);
    for run in runs {
        let (base_len, cur_len, same) = match run {
            Run::Same(s) => (s.len(), s.len(), true),
            Run::Added(s) => (0, s.len(), false),
            Run::Removed(s) => (s.len(), 0, false),
        };
        segs.push(Seg {
            base: b..b + base_len,
            cur: c..c + cur_len,
            same,
        });
        b += base_len;
        c += cur_len;
    }
    let cur_end = c;

    // Where base offset `x` falls in the current text: inside a run of
    // surviving text, at the matching byte; otherwise at the start of the
    // next run that has base text (after anything added in between).
    let place = |x: usize| -> usize {
        match segs.iter().find(|s| !s.base.is_empty() && x < s.base.end) {
            Some(seg) if seg.same => seg.cur.start + (x - seg.base.start),
            Some(seg) => seg.cur.start,
            None => cur_end,
        }
    };

    hunks
        .iter()
        .map(|h| {
            // Delete the base text that still exists; leave others' additions.
            let delete = segs
                .iter()
                .filter(|s| s.same && s.base.start < h.old.end && h.old.start < s.base.end)
                .map(|s| {
                    let from = h.old.start.max(s.base.start) - s.base.start + s.cur.start;
                    let to = h.old.end.min(s.base.end) - s.base.start + s.cur.start;
                    from..to
                })
                .collect();
            Op {
                delete,
                at: place(h.old.start),
                insert: h.insert.clone(),
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn synced_pair(text: &str) -> (NoteDoc, NoteDoc) {
        let a = NoteDoc::with_text(text, 0);
        let b = NoteDoc::load(&a.encode_state(), 0).unwrap();
        (a, b)
    }

    fn sync(a: &NoteDoc, b: &NoteDoc) {
        let to_b = a.encode_diff(&b.state_vector()).unwrap();
        let to_a = b.encode_diff(&a.state_vector()).unwrap();
        b.apply_update(&to_b).unwrap();
        a.apply_update(&to_a).unwrap();
    }

    #[test]
    fn saves_and_reloads() {
        let a = NoteDoc::with_text("# Hello\n", 0);
        a.apply_save("# Hello, world 🙂\n", None).unwrap();
        let b = NoteDoc::load(&a.encode_state(), 0).unwrap();
        assert_eq!(b.text(), "# Hello, world 🙂\n");
        assert_eq!(a.apply_save("# Hello, world 🙂\n", None).unwrap(), None);
    }

    #[test]
    fn merges_concurrent_saves() {
        let (a, b) = synced_pair("one\ntwo\nthree\n");
        a.apply_save("ONE\ntwo\nthree\n", None).unwrap();
        b.apply_save("one\ntwo\nTHREE\n", None).unwrap();
        sync(&a, &b);
        assert_eq!(a.text(), "ONE\ntwo\nTHREE\n");
        assert_eq!(b.text(), a.text());
    }

    #[test]
    fn a_stale_save_keeps_remote_edits() {
        let (a, b) = synced_pair("one\ntwo\nthree\n");
        // The editor on A loaded the text at this point...
        let editor_base = a.snapshot();
        // ...then B's edit arrived and was written to A's file...
        b.apply_save("one\ntwo\nthree\nfour from B\n", None)
            .unwrap();
        sync(&a, &b);
        assert_eq!(a.text(), "one\ntwo\nthree\nfour from B\n");
        // ...and A's dirty buffer, which never saw it, is saved.
        a.apply_save("ONE\ntwo\nthree\n", Some(&editor_base))
            .unwrap();
        assert_eq!(a.text(), "ONE\ntwo\nthree\nfour from B\n");
        sync(&a, &b);
        assert_eq!(b.text(), a.text());
    }

    #[test]
    fn a_stale_save_works_through_remote_deletes_and_inserts() {
        let (a, b) = synced_pair("alpha beta gamma delta\n");
        let editor_base = a.snapshot();
        b.apply_save("alpha gamma 日本 delta!\n", None).unwrap();
        sync(&a, &b);
        // A's buffer: deletes "gamma " and appends, unaware of B.
        a.apply_save("alpha beta delta 🙂\n", Some(&editor_base))
            .unwrap();
        // B's insertion survives inside A's deleted range; B's deletion of
        // "beta " stands; A's deletion of "gamma " and append apply.
        assert_eq!(a.text(), "alpha 日本 delta! 🙂\n");
        // Deleting in a stale buffer works around later additions too.
        sync(&a, &b);
        let base2 = a.snapshot();
        b.apply_save("alpha 日本 delta! 🙂 more\n", None).unwrap();
        sync(&a, &b);
        a.apply_save("alpha delta! 🙂\n", Some(&base2)).unwrap();
        assert_eq!(a.text(), "alpha delta! 🙂 more\n");
    }

    #[test]
    fn reads_earlier_text() {
        let a = NoteDoc::with_text("first", 0);
        let then = a.snapshot();
        a.apply_save("second", None).unwrap();
        assert_eq!(a.text_at(&then).unwrap(), "first");
        let copy = decode_snapshot(&encode_snapshot(&then)).unwrap();
        assert_eq!(a.text_at(&copy).unwrap(), "first");
    }

    #[test]
    fn reads_a_snapshot_that_cuts_a_merged_block() {
        // yrs merges consecutive typing by one author into one block; a base
        // made from two replicas' clocks can end inside it.
        let a = NoteDoc::with_text("first l", 0);
        let cut = a.snapshot();
        a.apply_save("first l\n- a日本", None).unwrap();
        let rebuilt = Snapshot::new(cut.state_map.clone(), cut.delete_set.clone());
        assert_eq!(a.text_at(&rebuilt).unwrap(), "first l");
    }
}
