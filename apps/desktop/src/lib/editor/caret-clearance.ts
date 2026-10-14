import { Plugin } from '@milkdown/kit/prose/state';
import type { EditorView } from '@milkdown/kit/prose/view';
import { $prose } from '@milkdown/kit/utils';

/** Room kept below the caret: about a line. (The keyboard and its bar are
    room the editor's pane makes, `useKeyboardRoom`.) */
const BELOW = 32;

function scroller(node: HTMLElement): HTMLElement | null {
  for (let el = node.parentElement; el; el = el.parentElement) {
    const { overflowY } = getComputedStyle(el);
    if (overflowY === 'auto' || overflowY === 'scroll') return el;
  }
  return null;
}

/**
 * Keeps the caret clear of the on-screen keyboard. The editor's scroll area
 * shrinks when the keyboard (and the keyboard bar above it) appear
 * (`useKeyboardRoom`), but ProseMirror
 * only scrolls to the caret when something's typed, so a line tapped near
 * the bottom stayed under the keyboard until then. When the pane changes
 * size with the editor focused, the caret is scrolled back into view.
 */
export const caretClearance = $prose(
  () =>
    new Plugin({
      props: {
        scrollMargin: { top: 16, bottom: BELOW, left: 0, right: 0 },
        scrollThreshold: { top: 0, bottom: BELOW, left: 0, right: 0 },
      },
      view(view: EditorView) {
        // Not in every environment the editor runs in (tests).
        if (typeof ResizeObserver === 'undefined') return {};
        let frame = 0;
        let height = 0;
        const follow = (entries: ResizeObserverEntry[]) => {
          const next = entries[0]?.contentRect.height ?? 0;
          const shrank = next < height;
          height = next;
          if (!shrank || !view.hasFocus()) return;
          cancelAnimationFrame(frame);
          frame = requestAnimationFrame(() => {
            if (view.isDestroyed || !view.hasFocus()) return;
            view.dispatch(view.state.tr.scrollIntoView());
          });
        };
        const observer = new ResizeObserver(follow);
        // The scroll container exists once the editor is in the page.
        const attach = requestAnimationFrame(() => {
          const pane = scroller(view.dom);
          if (pane) observer.observe(pane);
        });
        return {
          destroy() {
            cancelAnimationFrame(attach);
            cancelAnimationFrame(frame);
            observer.disconnect();
          },
        };
      },
    }),
);
