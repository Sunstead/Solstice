//! Whether two sides' edits since a common base touched the same text, so
//! that their merge deserves a human look (`docs/sync.md`, "Reviewing
//! overlapping edits").

use std::ops::Range;

use crate::diff::hunks;

/// True if the edits base→local and base→remote overlap.
///
/// Each change is widened to whole words first: two devices changing
/// different letters of one word ("colour" → "color" and "colour" → "hue")
/// garble it just as surely as changing the same letters. Two insertions at
/// the same point count only if they're not at a line start, so both sides
/// appending lines stays silent.
pub fn overlaps(base: &str, local: &str, remote: &str) -> bool {
    if local == base || remote == base || local == remote {
        return false;
    }
    let ours: Vec<Range<usize>> = hunks(base, local)
        .iter()
        .map(|h| widen(base, h.old.clone()))
        .collect();
    let theirs: Vec<Range<usize>> = hunks(base, remote)
        .iter()
        .map(|h| widen(base, h.old.clone()))
        .collect();
    ours.iter()
        .any(|a| theirs.iter().any(|b| clash(base, a, b)))
}

fn clash(base: &str, a: &Range<usize>, b: &Range<usize>) -> bool {
    match (a.is_empty(), b.is_empty()) {
        // Two insertions: only at the very same point, mid-line.
        (true, true) => a.start == b.start && !at_line_start(base, a.start),
        // An insertion strictly inside the other side's change.
        (true, false) => b.start < a.start && a.start < b.end,
        (false, true) => a.start < b.start && b.start < a.end,
        (false, false) => a.start < b.end && b.start < a.end,
    }
}

fn at_line_start(text: &str, at: usize) -> bool {
    at == 0 || text.as_bytes().get(at - 1) == Some(&b'\n')
}

fn is_word(c: char) -> bool {
    c.is_alphanumeric() || c == '_'
}

/// Grows a byte range to the word boundaries around it. An empty range (an
/// insertion) grows only if it touches a word: typing onto the end of a word
/// changes that word.
fn widen(text: &str, range: Range<usize>) -> Range<usize> {
    let before = |at: usize| text[..at].chars().next_back();
    let after = |at: usize| text[at..].chars().next();
    let touches_word =
        |at: usize| before(at).is_some_and(is_word) || after(at).is_some_and(is_word);

    if range.is_empty() && !touches_word(range.start) {
        return range;
    }
    let mut start = range.start;
    while let Some(c) = before(start).filter(|c| is_word(*c)) {
        start -= c.len_utf8();
    }
    let mut end = range.end;
    while let Some(c) = after(end).filter(|c| is_word(*c)) {
        end += c.len_utf8();
    }
    // An insertion inside a word becomes a change of that word.
    start..end
}

#[cfg(test)]
mod tests {
    use super::overlaps;

    #[test]
    fn flags_the_spikes_bad_merges() {
        // Same word, changed two ways.
        assert!(overlaps(
            "The colour is red.\n",
            "The color is red.\n",
            "The hue is red.\n"
        ));
        // A line deleted on one side, edited on the other.
        assert!(overlaps(
            "keep\ndoomed line here\nkeep too\n",
            "keep\nkeep too\n",
            "keep\ndoomed line here, with B's addition\nkeep too\n",
        ));
        // A rewrite against a small edit.
        assert!(overlaps(
            "teh quick brown fox\n",
            "# A heading now\n\nThe quick brown fox jumps.\n",
            "teh quick brown fox!!\n",
        ));
        // Typing into the same word.
        assert!(overlaps("a word b", "a wordy b", "a swords b"));
    }

    #[test]
    fn stays_silent_for_clean_merges() {
        // Different paragraphs.
        assert!(!overlaps(
            "Alpha para.\n\nBeta para.\n\nGamma para.\n",
            "Alpha para, edited by A.\n\nBeta para.\n\nGamma para.\n",
            "Alpha para.\n\nBeta para.\n\nGamma para, edited by B.\n",
        ));
        // Both appending lines.
        assert!(!overlaps(
            "List:\n- one\n",
            "List:\n- one\n- from A\n",
            "List:\n- one\n- from B\n"
        ));
        // Different words on one line.
        assert!(!overlaps(
            "one two three\n",
            "ONE two three\n",
            "one two THREE\n"
        ));
        // Only one side changed, or both made the same change.
        assert!(!overlaps("x", "y", "x"));
        assert!(!overlaps("x", "y", "y"));
    }

    #[test]
    fn handles_multibyte_text() {
        assert!(overlaps(
            "日本語 🙂 text",
            "日本 🙂 text",
            "日本語語 🙂 text"
        ));
        assert!(!overlaps(
            "日本語 🙂 text",
            "日本語 🙂 TEXT",
            "日本 🙂 text"
        ));
    }
}
