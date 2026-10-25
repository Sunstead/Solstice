import { useCallback } from 'react';

/**
 * iOS's scroll edge effect, for a phone page's bars: a bar is the page's own
 * colour at rest, and marks itself `data-scrolled` once content has scrolled
 * under it (`top`: anything below scrolled down; `bottom`: anything above not
 * yet at its end), so its blurred fade shows (`.phone-bar` in app.css).
 *
 * It watches every scroll in the bar's parent, on the capture phase, so it
 * needs no hold on whichever list the page shows. A sideways scroll (a board)
 * doesn't count.
 */
export function useScrollEdge(edge: 'top' | 'bottom') {
  return useCallback(
    (bar: HTMLElement | null) => {
      const area = bar?.parentElement;
      if (!bar || !area) return;
      const onScroll = (event: Event) => {
        const el = event.target;
        if (!(el instanceof HTMLElement) || el.scrollHeight <= el.clientHeight) return;
        const under = edge === 'top' ? el.scrollTop > 0 : el.scrollTop + el.clientHeight < el.scrollHeight - 1;
        bar.toggleAttribute('data-scrolled', under);
      };
      area.addEventListener('scroll', onScroll, { capture: true, passive: true });
      return () => area.removeEventListener('scroll', onScroll, { capture: true });
    },
    [edge],
  );
}
