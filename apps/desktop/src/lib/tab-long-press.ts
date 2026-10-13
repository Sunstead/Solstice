import { useEffect } from 'react';

/** Where a tab's menu was asked for, and for which tab. */
export type TabMenuRequest = { tabId: string; x: number; y: number };

/** Long enough not to be a tap, short enough not to feel stuck. */
const HOLD_MS = 450;
/** A finger that moves this far is dragging the tab, not holding it. */
const SLOP_PX = 8;

/**
 * Opens a tab's menu when a finger or the Pencil holds it still on a tab
 * (iOS fires no `contextmenu` for a touch). A mouse's right click comes
 * through flexlayout's `onContextMenu` instead.
 */
export function useTabLongPress(open: (request: TabMenuRequest) => void, close: () => void) {
  useEffect(() => {
    let timer = 0;
    let start: { x: number; y: number } | null = null;
    // After the menu opens, the lift's own events (iOS follows a touch with
    // mousedown and click) would land outside the menu and close it.
    let held = false;
    let swallowUntil = 0;
    const swallow = (event: Event) => {
      if (performance.now() > swallowUntil) return;
      event.preventDefault();
      event.stopPropagation();
    };
    const cancel = () => {
      clearTimeout(timer);
      start = null;
    };
    const onDown = (event: PointerEvent) => {
      if (event.pointerType === 'mouse') return;
      const button = (event.target as Element | null)?.closest<HTMLElement>('.flexlayout__tab_button');
      // The tab's id is in flexlayout's button id: flexlayout-tabbutton-<id>.
      const tabId = button?.id.replace(/^flexlayout-tabbutton-/, '');
      if (!button || !tabId || tabId === button.id) return;
      cancel();
      start = { x: event.clientX, y: event.clientY };
      origin = start;
      const { x, y } = start;
      timer = window.setTimeout(() => {
        start = null;
        held = true;
        open({ tabId, x, y });
      }, HOLD_MS);
    };
    // A tab can be dragged, so iOS lifts it for a drag on a long press and
    // cancels the touch: the hold goes on through that, and gives way only
    // if the tab is moved (then it's a drag, and the menu goes).
    let origin: { x: number; y: number } | null = null;
    const moved = (x: number, y: number) =>
      origin !== null && (x !== 0 || y !== 0) && Math.hypot(x - origin.x, y - origin.y) > SLOP_PX;
    const onMove = (event: PointerEvent) => {
      if (start && moved(event.clientX, event.clientY)) cancel();
    };
    const onDrag = (event: DragEvent) => {
      if (!moved(event.clientX, event.clientY)) return;
      cancel();
      origin = null;
      if (held) {
        held = false;
        close();
      }
    };
    // The lift ends the hold (or the drag iOS began, if it went nowhere);
    // only what follows straight after is swallowed.
    const onUp = (event: Event) => {
      cancel();
      origin = null;
      if (!held) return;
      held = false;
      swallowUntil = performance.now() + 500;
      swallow(event);
    };
    const lifted = ['mousedown', 'mouseup', 'click'] as const;
    window.addEventListener('pointerdown', onDown, { capture: true });
    window.addEventListener('pointermove', onMove, { capture: true });
    window.addEventListener('pointerup', onUp, { capture: true });
    window.addEventListener('dragover', onDrag, { capture: true });
    // The strip panned instead (iOS cancels the touch for that too).
    window.addEventListener('scroll', cancel, { capture: true });
    window.addEventListener('drag', onDrag, { capture: true });
    window.addEventListener('dragend', onUp, { capture: true });
    for (const type of lifted) window.addEventListener(type, swallow, { capture: true });
    return () => {
      cancel();
      window.removeEventListener('pointerdown', onDown, { capture: true });
      window.removeEventListener('pointermove', onMove, { capture: true });
      window.removeEventListener('pointerup', onUp, { capture: true });
      window.removeEventListener('dragover', onDrag, { capture: true });
      window.removeEventListener('scroll', cancel, { capture: true });
      window.removeEventListener('drag', onDrag, { capture: true });
      window.removeEventListener('dragend', onUp, { capture: true });
      for (const type of lifted) window.removeEventListener(type, swallow, { capture: true });
    };
  }, [open, close]);
}
