//! Text diffs, in byte offsets of the old text.

use std::ops::Range;
use std::time::Duration;

use similar::{ChangeTag, TextDiff};

/// One change: replace `old` (a byte range of the old text) with `insert`.
/// A pure insertion has an empty range; a pure deletion an empty `insert`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Hunk {
    pub old: Range<usize>,
    pub insert: String,
}

/// Character-level Myers diff, as hunks in ascending order of the old text.
///
/// Characters rather than words or lines: the spike (`docs/sync.md`) found
/// coarser diffs merged worse overall. Long diffs give up after a short
/// deadline and fall back to a coarser, still correct, answer.
pub fn hunks(old: &str, new: &str) -> Vec<Hunk> {
    let diff = TextDiff::configure()
        .timeout(Duration::from_millis(250))
        .diff_chars(old, new);
    let mut out: Vec<Hunk> = Vec::new();
    let mut pos = 0;
    for change in diff.iter_all_changes() {
        let value = change.value();
        match change.tag() {
            ChangeTag::Equal => pos += value.len(),
            ChangeTag::Delete => {
                match out.last_mut() {
                    Some(h) if h.old.end == pos => h.old.end += value.len(),
                    _ => out.push(Hunk {
                        old: pos..pos + value.len(),
                        insert: String::new(),
                    }),
                }
                pos += value.len();
            }
            ChangeTag::Insert => match out.last_mut() {
                Some(h) if h.old.end == pos => h.insert.push_str(value),
                _ => out.push(Hunk {
                    old: pos..pos,
                    insert: value.to_string(),
                }),
            },
        }
    }
    out
}

/// Left-to-right edits on the evolving text: `(at, delete_len, insert)`,
/// where each `at` already accounts for the edits before it.
pub fn edits(hunks: &[Hunk]) -> impl Iterator<Item = (usize, usize, &str)> + '_ {
    let mut shift: isize = 0;
    hunks.iter().map(move |h| {
        let at = (h.old.start as isize + shift) as usize;
        shift += h.insert.len() as isize - h.old.len() as isize;
        (at, h.old.len(), h.insert.as_str())
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn apply(old: &str, hunks: &[Hunk]) -> String {
        let mut s = old.to_string();
        for (at, del, ins) in edits(hunks) {
            s.replace_range(at..at + del, ins);
        }
        s
    }

    #[test]
    fn round_trips() {
        for (a, b) in [
            ("", "hello"),
            ("hello", ""),
            ("The colour is red.", "The hue is red."),
            ("a 日本 🙂 b", "a 本日 b 🙂"),
            ("same", "same"),
        ] {
            assert_eq!(apply(a, &hunks(a, b)), b, "{a:?} -> {b:?}");
        }
    }

    #[test]
    fn merges_adjacent_changes_into_one_hunk() {
        assert_eq!(
            hunks("abc", "aXc"),
            vec![Hunk {
                old: 1..2,
                insert: "X".into()
            }]
        );
        assert_eq!(
            hunks("abc", "abc!"),
            vec![Hunk {
                old: 3..3,
                insert: "!".into()
            }]
        );
    }
}
