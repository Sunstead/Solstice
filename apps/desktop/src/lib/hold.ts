import { useEffect, useRef } from 'react';

import { haptics } from '@/lib/haptics';

/** The system's long press. */
const HOLD_MS = 400;
/** Further than this and it's a scroll or a drag. */
const SLOP = 8;

/**
 * The click the finger's lift may make after a hold, wherever it lands: by
 * then what the hold opened (a sheet, and its dim) is under the finger, and
 * the click would close it. Only one that comes with the lift: iOS often
 * sends none after a long press, and the next tap is the user's.
 */
function swallowLiftClick() {
  document.addEventListener(
    'pointerup',
    () => {
      const swallow = (event: MouseEvent) => {
        event.preventDefault();
        event.stopPropagation();
      };
      document.addEventListener('click', swallow, { capture: true, once: true });
      window.setTimeout(() => document.removeEventListener('click', swallow, { capture: true }), 80);
    },
    { capture: true, once: true },
  );
}

/**
 * A touch hold, the phone's way into an item's actions (the hold sheet):
 * when it's recognised the item dips (`data-held`, app.css) and the impact
 * haptic plays, then `onHold` runs. Moving first never holds, and the click
 * the lift would make is swallowed. A mouse's right click does the same.
 */
export function useHold(onHold: () => void) {
  const press = useRef<{ x: number; y: number; id: number; el: HTMLElement; timer: number } | null>(null);
  const held = useRef(false);
  const latest = useRef(onHold);
  useEffect(() => {
    latest.current = onHold;
  });

  const cancel = () => {
    const p = press.current;
    if (!p) return;
    clearTimeout(p.timer);
    p.el.removeAttribute('data-held');
    press.current = null;
  };
  useEffect(() => cancel, []);

  return {
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
      if (e.pointerType === 'mouse' || !e.isPrimary) return;
      cancel();
      held.current = false;
      haptics.prepare();
      const el = e.currentTarget;
      const timer = window.setTimeout(() => {
        held.current = true;
        swallowLiftClick();
        el.setAttribute('data-held', '');
        haptics.play('hold');
        latest.current();
        // The dip lasts as long as the sheet takes to rise over it.
        window.setTimeout(() => el.removeAttribute('data-held'), 250);
        press.current = null;
      }, HOLD_MS);
      press.current = { x: e.clientX, y: e.clientY, id: e.pointerId, el, timer };
    },
    onPointerMove: (e: React.PointerEvent) => {
      const p = press.current;
      if (p && p.id === e.pointerId && Math.hypot(e.clientX - p.x, e.clientY - p.y) > SLOP) cancel();
    },
    onPointerUp: cancel,
    onPointerCancel: cancel,
    onContextMenu: (e: React.MouseEvent) => {
      e.preventDefault();
      if (held.current) return;
      latest.current();
    },
  };
}
