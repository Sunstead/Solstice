import type { MilkdownPlugin } from '@milkdown/kit/ctx';
import { InputRule } from '@milkdown/kit/prose/inputrules';
import { keymap } from '@milkdown/kit/prose/keymap';
import { TextSelection, type EditorState } from '@milkdown/kit/prose/state';
import { $inputRule, $prose } from '@milkdown/kit/utils';

import { getSetting } from '@/lib/settings/store';

/**
 * Brackets and quotes only. Emphasis characters are deliberately absent:
 * `*`, `_` and `` ` `` already belong to commonmark's own input rules, and
 * pairing them would fight the rules that turn them into formatting.
 */
const PAIRS: Record<string, string> = {
  '(': ')',
  '[': ']',
  '{': '}',
  '"': '"',
  "'": "'",
};

const CLOSERS = new Set(Object.values(PAIRS));

/** Symmetric marks need a heuristic; asymmetric brackets never do. */
const SYMMETRIC = new Set(['"', "'"]);

const WORD = /[\p{L}\p{N}]/u;

const enabled = () => getSetting('editor.autoPairBrackets');

function characterAt(state: EditorState, pos: number): string {
  if (pos < 0 || pos >= state.doc.content.size) return '';
  return state.doc.textBetween(pos, pos + 1);
}

/**
 * Inline code is verbatim text; pairing inside it would insert characters the
 * author did not type into content that means exactly what it says. Fenced
 * code needs no check -- ProseMirror's input-rule runner already skips any
 * textblock whose spec is `code`.
 */
function inVerbatim(state: EditorState, pos: number): boolean {
  const marks = state.storedMarks ?? state.doc.resolve(pos).marks();
  return marks.some(
    (mark) => mark.type.name === 'inlineCode' || mark.type.name === 'math_inline',
  );
}

/**
 * Steps over a closing character that is already there, rather than inserting
 * a second one -- the same trick the wikilink module used for `]]`, now
 * general. Registered before the opening rule so a symmetric quote closes an
 * open pair instead of starting a new one.
 */
const skipClosing = $inputRule(
  () =>
    new InputRule(/[)\]}"']$/, (state, match, start, end) => {
      if (!enabled()) return null;
      if (!state.selection.empty) return null;
      if (!CLOSERS.has(match[0])) return null;
      if (inVerbatim(state, start)) return null;
      if (characterAt(state, end) !== match[0]) return null;

      // A selection-only transaction: nothing is inserted, so this never marks
      // the buffer dirty and never lands in the undo history as an edit.
      return state.tr.setSelection(TextSelection.create(state.doc, end + 1));
    }),
);

/**
 * Opens a pair, or wraps the selection in one.
 *
 * With a selection, ProseMirror hands the rule the whole replaced range, so
 * wrapping and pairing are the same rule. The closing character is inserted
 * first so the opening insert shifts it along automatically.
 */
const openPair = $inputRule(
  () =>
    new InputRule(/[([{"']$/, (state, match, start, end) => {
      if (!enabled()) return null;

      const open = match[0];
      const close = PAIRS[open];
      if (!close) return null;
      if (inVerbatim(state, start)) return null;

      if (end > start) {
        const tr = state.tr;
        tr.insertText(close, end);
        tr.insertText(open, start);

        return tr.setSelection(
          TextSelection.create(tr.doc, start + 1, end + 1),
        );
      }

      // Typing an opener directly against a word is nearly always the start of
      // ordinary prose -- an apostrophe in "don't", a bracket before an
      // existing token -- rather than a request for a pair.
      const after = characterAt(state, end);
      if (after && WORD.test(after)) return null;

      if (SYMMETRIC.has(open)) {
        const before = characterAt(state, start - 1);
        if (before && WORD.test(before)) return null;
      }

      const tr = state.tr.insertText(open + close, start, end);
      return tr.setSelection(TextSelection.create(tr.doc, start + 1));
    }),
);

/**
 * Backspace between the two halves of a pair removes both.
 *
 * A `$prose` keymap runs ahead of Milkdown's assembled keymap, so this
 * pre-empts `undoInputRule` -- which would restore just the opener and leave
 * an orphan. Returning false when the caret is not between a pair hands the
 * key straight back to the default chain.
 */
const clearPair = $prose(() =>
  keymap({
    Backspace: (state, dispatch) => {
      if (!enabled()) return false;
      if (!state.selection.empty) return false;

      const pos = state.selection.from;
      const before = characterAt(state, pos - 1);
      if (!before || PAIRS[before] !== characterAt(state, pos)) return false;

      dispatch?.(state.tr.delete(pos - 1, pos + 1));
      return true;
    },
  }),
);

export const autoPair: MilkdownPlugin[] = [
  skipClosing,
  openPair,
  clearPair,
].flat();
