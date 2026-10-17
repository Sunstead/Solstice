import { useEffect } from 'react';

/**
 * Where a tab's menu was asked for, and for which tab. `held`: by holding the
 * tab, which may go on into a drag, so the menu mustn't cover the strip.
 */
export type TabMenuRequest = { tabId: string; x: number; y: number; held?: boolean };

/** Long enough not to be a tap, short enough not to feel stuck. */
const HOLD_MS = 500;
/** A finger that moves this far is dragging the tab, not holding it. */
const SLOP_PX = 10;

/** The tab a press landed on, by its real id (`TabLabel`'s `data-tab-id`). */
function tabAt(target: EventTarget | null): { button: HTMLElement; tabId: string } | null {
  const button = (target as Element | null)?.closest?.<HTMLElement>('.flexlayout__tab_button');
  const tabId = button?.querySelector<HTMLElement>('[data-tab-id]')?.dataset.tabId;
  return button && tabId ? { button, tabId } : null;
}

/**
 * Opens a tab's menu when a finger or the Pencil holds it (iOS fires no
 * `contextmenu` for a touch), the way iOS does for anything that can also be
 * dragged: holding still lifts the tab and opens its menu, and moving it from
 * there is a drag, which closes the menu. Let go without moving and the menu
 * stays. A mouse's right click comes through flexlayout's `onContextMenu`.
 *
 * Tabs are HTML5-draggable, so iOS lifts a held tab itself and cancels the
 * touch (`dragstart`, then only drag events): the menu opens at that lift,
 * or after `HOLD_MS` if no lift comes.
 */
export function useTabLongPress(open: (request: TabMenuRequest) => void, close: () => void) {
  useEffect(() => {
    let timer = 0;
    /** A hold in progress: where it started, on which tab. */
    let pending: (TabMenuRequest & { button: HTMLElement }) | null = null;
    /** Where the press started, while a move from there can still make it a drag. */
    let origin: { x: number; y: number } | null = null;
    /** The menu is open from a hold that hasn't been let go of. */
    let held = false;
    // After the menu opens, the lift's own events (iOS follows a touch with
    // mousedown and click) would land outside the menu and close it.
    let swallowUntil = 0;
    const swallow = (event: Event) => {
      // While held, iOS lifts the tab with a mousedown of its own on the way
      // to `dragstart` (after the menu, if the hold won): the menu would close
      // for it as a press outside. Stopped but not cancelled, or no drag.
      if (held && event.type === 'mousedown') {
        event.stopPropagation();
        return;
      }
      if (performance.now() > swallowUntil) return;
      event.preventDefault();
      event.stopPropagation();
    };
    const cancel = () => {
      clearTimeout(timer);
      pending = null;
    };
    const openNow = () => {
      if (!pending) return;
      const { tabId, x, y } = pending;
      cancel();
      held = true;
      open({ tabId, x, y, held: true });
    };
    const moved = (x: number, y: number) =>
      origin !== null && (x !== 0 || y !== 0) && Math.hypot(x - origin.x, y - origin.y) > SLOP_PX;

    const onDown = (event: PointerEvent) => {
      // A new press: whatever the last one left behind is over.
      held = false;
      cancel();
      origin = null;
      if (event.pointerType === 'mouse') return;
      const tab = tabAt(event.target);
      if (!tab) return;
      origin = { x: event.clientX, y: event.clientY };
      pending = { ...tab, x: event.clientX, y: event.clientY };
      timer = window.setTimeout(openNow, HOLD_MS);
    };
    const onMove = (event: PointerEvent) => {
      if (pending && moved(event.clientX, event.clientY)) cancel();
    };
    // iOS cancels the touch when it lifts the tab, and `dragstart` follows
    // at once; a cancel with no lift after it (a system gesture) ends the hold.
    const onCancel = () => {
      const was = pending;
      window.setTimeout(() => {
        if (pending && pending === was) cancel();
      }, 150);
    };
    // iOS lifted the tab for a drag because it was held: that's the hold.
    const onDragStart = () => {
      if (pending) openNow();
    };
    // Moved after the lift: a drag after all, so the menu goes.
    const onDrag = (event: DragEvent) => {
      if (!moved(event.clientX, event.clientY)) return;
      cancel();
      origin = null;
      if (held) {
        held = false;
        close();
      }
    };
    // Let go where it was lifted: not a move, so flexlayout mustn't re-dock
    // the tab. Its drag still ends (`dragend` is never stopped).
    const onDrop = (event: DragEvent) => {
      if (!held || origin === null) return;
      event.preventDefault();
      event.stopPropagation();
    };
    // The lift ends the hold; only what follows straight after is swallowed.
    const onUp = (event: Event) => {
      cancel();
      origin = null;
      if (!held) return;
      held = false;
      swallowUntil = performance.now() + 500;
      if (event.type === 'pointerup') swallow(event);
    };
    // The strip panned instead (iOS cancels the touch for that too). Only a
    // scroll of something holding the tab counts: flexlayout scrolling the
    // strip to show a tab, or anything elsewhere, doesn't.
    const onScroll = (event: Event) => {
      if (pending && event.target instanceof Node && event.target.contains(pending.button)) cancel();
    };

    const lifted = ['mousedown', 'mouseup', 'click'] as const;
    const listeners: [string, EventListener][] = [
      ['pointerdown', onDown as EventListener],
      ['pointermove', onMove as EventListener],
      ['pointerup', onUp],
      ['pointercancel', onCancel],
      ['dragstart', onDragStart],
      ['drag', onDrag as EventListener],
      ['dragover', onDrag as EventListener],
      ['drop', onDrop as EventListener],
      ['dragend', onUp],
      ['scroll', onScroll],
      ...lifted.map((type): [string, EventListener] => [type, swallow]),
    ];
    for (const [type, listener] of listeners) window.addEventListener(type, listener, { capture: true });
    return () => {
      cancel();
      for (const [type, listener] of listeners) window.removeEventListener(type, listener, { capture: true });
    };
  }, [open, close]);
}
