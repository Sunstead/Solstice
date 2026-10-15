import { EditorView as SourceView, ViewPlugin } from '@codemirror/view';
import { Plugin } from '@milkdown/kit/prose/state';
import type { EditorView } from '@milkdown/kit/prose/view';
import { $prose } from '@milkdown/kit/utils';

/** Room kept below the caret: about a line. (The keyboard and its bar are
    room the editor's pane makes, `useKeyboardRoom`.) */
const BELOW = 32;
const ABOVE = 16;

function scroller(node: HTMLElement): HTMLElement | null {
  for (let el = node.parentElement; el; el = el.parentElement) {
    const { overflowY } = getComputedStyle(el);
    if (overflowY === 'auto' || overflowY === 'scroll') return el;
  }
  return null;
}

/**
 * Calls `reveal` when the scroll area around `dom` shrinks while the editor
 * has focus: the keyboard (and the keyboard bar above it) came up, and the
 * pane made room (`useKeyboardRoom`). Editors only scroll to the caret when
 * something's typed, so a line tapped near the bottom stayed under the
 * keyboard until then. Returns a cleanup.
 */
function onPaneShrink(dom: HTMLElement, hasFocus: () => boolean, reveal: () => void): () => void {
  // Not in every environment the editors run in (tests).
  if (typeof ResizeObserver === 'undefined') return () => {};
  let frame = 0;
  let height = 0;
  const observer = new ResizeObserver((entries) => {
    const next = entries[0]?.contentRect.height ?? 0;
    const shrank = next < height;
    height = next;
    if (!shrank || !hasFocus()) return;
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      if (hasFocus()) reveal();
    });
  });
  // The scroll container exists once the editor is in the page.
  const attach = requestAnimationFrame(() => {
    const pane = scroller(dom);
    if (pane) observer.observe(pane);
  });
  return () => {
    cancelAnimationFrame(attach);
    cancelAnimationFrame(frame);
    observer.disconnect();
  };
}

/** Keeps a note's caret clear of the on-screen keyboard (`onPaneShrink`). */
export const caretClearance = $prose(
  () =>
    new Plugin({
      props: {
        scrollMargin: { top: ABOVE, bottom: BELOW, left: 0, right: 0 },
        scrollThreshold: { top: 0, bottom: BELOW, left: 0, right: 0 },
      },
      view(view: EditorView) {
        const destroy = onPaneShrink(
          view.dom,
          () => !view.isDestroyed && view.hasFocus(),
          () => view.dispatch(view.state.tr.scrollIntoView()),
        );
        return { destroy };
      },
    }),
);

/** The same for source mode's CodeMirror. */
export const sourceCaretClearance = [
  SourceView.scrollMargins.of(() => ({ top: ABOVE, bottom: BELOW })),
  ViewPlugin.define((view) => ({
    destroy: onPaneShrink(
      view.dom,
      () => view.hasFocus,
      () =>
        view.dispatch({
          effects: SourceView.scrollIntoView(view.state.selection.main.head, { y: 'nearest', yMargin: BELOW }),
        }),
    ),
  })),
];
