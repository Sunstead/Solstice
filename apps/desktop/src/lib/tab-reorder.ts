/**
 * The arithmetic of reordering a strip of tabs by hand, apart from the DOM.
 * Every tab takes the same room (`tab-motion.ts` relies on that too), so a
 * tab dragged past another swaps places with it, and the others only ever
 * move a whole slot.
 */

/** Where a dragged tab lands: the count of the other tabs whose centres it is right of. */
export function targetIndex(centres: number[], from: number, x: number): number {
  let to = 0;
  centres.forEach((centre, i) => {
    if (i !== from && centre < x) to++;
  });
  return to;
}

/**
 * How far each tab sits from where it rests while `from` is dragged to `to`:
 * the ones passed make way by one slot, the dragged tab's own slot is left
 * to the caller (it travels with the finger).
 */
export function shifts(count: number, from: number, to: number, slot: number): number[] {
  return Array.from({ length: count }, (_, i) => {
    if (i === from) return 0;
    if (from < to && i > from && i <= to) return -slot;
    if (from > to && i >= to && i < from) return slot;
    return 0;
  });
}

/**
 * The `index` for flexlayout's `moveNode` into the same tabset: it counts
 * in the strip before the tab leaves it, so a move right lands one past.
 */
export function dropIndex(from: number, to: number): number {
  return to > from ? to + 1 : to;
}

/** Keeps `value` between `min` and `max`. */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** How far a tab follows the finger up or down: a quarter, never past `limit`. */
export function lag(dy: number, limit = 12): number {
  return clamp(dy * 0.25, -limit, limit);
}
