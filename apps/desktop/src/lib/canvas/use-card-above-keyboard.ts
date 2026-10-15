import { useEffect, type RefObject } from 'react';

import { caretOverlap, useKeyboard, useKeyboardBarShown } from '@/lib/keyboard';
import { useCanvasStoreApi } from './use-canvas-store';

/** Where the caret ends, in viewport pixels; an empty line has no rect of its own. */
function caretBottom(): number | null {
  const selection = document.getSelection();
  if (!selection || selection.rangeCount === 0) return null;
  const rect = selection.getRangeAt(0).getBoundingClientRect();
  if (rect.height > 0) return rect.bottom;
  const node = selection.focusNode;
  const element = node instanceof Element ? node : node?.parentElement;
  return element ? element.getBoundingClientRect().bottom : null;
}

/**
 * Keeps the caret of the card being edited above a docked keyboard (and the
 * keyboard bar on it): the board pans up just enough. A board isn't a
 * scrolling pane, so `useKeyboardRoom` can't make room on it.
 */
export function useCardAboveKeyboard(host: RefObject<HTMLElement | null>) {
  const store = useCanvasStoreApi();
  const inset = useKeyboard((s) => s.inset);
  const docked = useKeyboard((s) => s.docked);
  const bar = useKeyboardBarShown();

  useEffect(() => {
    const el = host.current;
    if (!el || !docked) return;
    const reveal = () => {
      if (!el.contains(document.activeElement)) return;
      const bottom = caretBottom();
      if (bottom === null) return;
      const by = caretOverlap({ caretBottom: bottom, viewportHeight: window.innerHeight, inset, bar });
      if (by <= 0) return;
      const { view, setView } = store.getState();
      setView({ ...view, offset: { x: view.offset.x, y: view.offset.y - by } });
    };
    reveal();
    document.addEventListener('selectionchange', reveal);
    return () => document.removeEventListener('selectionchange', reveal);
  }, [host, store, inset, docked, bar]);
}
