/**
 * Source text the editor collapses (a wikilink's brackets, inline math, a
 * callout's `[!type]`, a comment's `%%`), and the caret rules over it:
 *
 * - R1: Left and Right move one place at a time in and around it, in JS, not
 *   by the browser, which steps into the zero-width boxes it's hidden in.
 * - R2: a caret landing inside collapsed source (a click, Alt-arrow) moves to
 *   its edge, the way it was going.
 * - R3: Backspace and Delete next to it remove one character, which is shown,
 *   since the caret touching a source reveals it.
 *
 * Each hiding plugin says what it hides through `hiddenSource` on its spec.
 */
import type { EditorState, PluginSpec, Selection } from '@milkdown/kit/prose/state';
import { Plugin, PluginKey, TextSelection, type Command } from '@milkdown/kit/prose/state';
import { $prose } from '@milkdown/kit/utils';

export interface HiddenSource {
  /** The whole source, which the arrows and deletes step through one by one. */
  from: number;
  to: number;
  /** What's hidden while it's collapsed. */
  hidden: { from: number; to: number }[];
  collapsed: boolean;
}

/** The field a plugin's spec carries to publish its sources. */
export interface HiddenSourceSpec extends PluginSpec<unknown> {
  hiddenSource?: (state: EditorState) => HiddenSource[];
}

/** Whether the selection touches `from`..`to`, edges included: what reveals a source. */
export function touches(selection: Pick<Selection, 'from' | 'to'>, from: number, to: number): boolean {
  return selection.from <= to && selection.to >= from;
}

export function hiddenSources(state: EditorState): HiddenSource[] {
  return state.plugins.flatMap((plugin) => (plugin.spec as HiddenSourceSpec).hiddenSource?.(state) ?? []);
}

function within(sources: HiddenSource[], from: number, to: number): boolean {
  return sources.some((source) => source.from <= from && to <= source.to);
}

/** The caret, if it's a plain one in text. */
function caretOf(state: EditorState) {
  const { selection } = state;
  return selection instanceof TextSelection ? selection.$cursor : null;
}

/** Left (-1) or Right (1) by one place, when that's in or at the edge of a source. */
export function stepOverSource(dir: -1 | 1): Command {
  return (state, dispatch) => {
    const $caret = caretOf(state);
    if (!$caret) return false;
    const target = $caret.pos + dir;
    if (target < $caret.start() || target > $caret.end()) return false;
    const sources = hiddenSources(state);
    if (!within(sources, Math.min($caret.pos, target), Math.max($caret.pos, target))) {
      // Arriving at an edge counts too: that's where the browser misjudges.
      if (!sources.some((source) => source.from === target || source.to === target)) return false;
    }
    dispatch?.(state.tr.setSelection(TextSelection.create(state.doc, target)).scrollIntoView());
    return true;
  };
}

/** Backspace (-1) or Delete (1) of one character of a source. */
export function deleteInSource(dir: -1 | 1): Command {
  return (state, dispatch) => {
    const $caret = caretOf(state);
    if (!$caret) return false;
    const from = dir < 0 ? $caret.pos - 1 : $caret.pos;
    const to = from + 1;
    if (from < $caret.start() || to > $caret.end()) return false;
    if (!within(hiddenSources(state), from, to)) return false;
    if (!state.doc.resolve(dir < 0 ? $caret.pos : $caret.pos + 1).nodeBefore?.isText) return false;
    dispatch?.(state.tr.delete(from, to).scrollIntoView());
    return true;
  };
}

/** Where a caret at `head` inside collapsed source goes: its edge, the way it was going. */
function snap(sources: HiddenSource[], head: number, previous: number): number | null {
  for (const source of sources) {
    if (!source.collapsed) continue;
    for (const piece of source.hidden) {
      if (head <= piece.from || head >= piece.to) continue;
      if (head > previous) return piece.to;
      if (head < previous) return piece.from;
      return head - piece.from <= piece.to - head ? piece.from : piece.to;
    }
  }
  return null;
}

const key = new PluginKey('hidden-ranges');

export const hiddenRanges = $prose(
  () =>
    new Plugin({
      key,
      props: {
        handleKeyDown(view, event) {
          if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return false;
          const dir = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0;
          if (!dir) return false;
          return stepOverSource(dir)(view.state, view.dispatch);
        },
      },
      // R2. Only a selection that moved on its own: an edit puts the caret
      // where it means to.
      appendTransaction(transactions, oldState, state) {
        if (transactions.some((tr) => tr.docChanged) || !transactions.some((tr) => tr.selectionSet)) return null;
        const $caret = caretOf(state);
        if (!$caret) return null;
        const to = snap(hiddenSources(oldState), $caret.pos, oldState.selection.head);
        if (to === null || to === $caret.pos) return null;
        return state.tr.setSelection(TextSelection.create(state.doc, to));
      },
    }),
);
