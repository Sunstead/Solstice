/**
 * Arranging a PDF's pages in the page sheet: an order is the indices of the
 * pages as they are, in their new places; pages left out are deleted
 * (`solstice-pdf`'s `apply_arranged`, through `nativeInk.arrangePages`).
 */

export const identity = (count: number): number[] => Array.from({ length: count }, (_, i) => i);

/** `order` with the page at `from` moved to `to`. */
export function movePage(order: number[], from: number, to: number): number[] {
  const n = order.length;
  if (from < 0 || from >= n || to < 0 || to >= n) return order;
  if (from === to) return [...order];
  const next = [...order];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

/** `order` without the pages at `places`; a PDF keeps at least one page. */
export function removePages(order: number[], places: number[]): number[] {
  const gone = new Set(places);
  const next = order.filter((_, i) => !gone.has(i));
  return next.length === 0 ? order : next;
}

export type Point = { x: number; y: number };

/** The slot of a grid whose centre is nearest `point`, or -1 for none. */
export function gridTarget(centres: Point[], point: Point): number {
  let best = -1;
  let distance = Infinity;
  centres.forEach((c, i) => {
    const d = (c.x - point.x) ** 2 + (c.y - point.y) ** 2;
    if (d < distance) {
      distance = d;
      best = i;
    }
  });
  return best;
}

/**
 * Where each slot moves while the one at `from` is held over `to`, in a
 * list that wraps (a grid read row by row): the ones between take the next
 * slot's place. The held one is left at zero; it follows the finger.
 */
export function flowOffsets(points: Point[], from: number, to: number): Point[] {
  const order = points.map((_, i) => i).filter((i) => i !== from);
  order.splice(to, 0, from);
  const offsets = points.map(() => ({ x: 0, y: 0 }));
  order.forEach((i, slot) => {
    if (i !== from) offsets[i] = { x: points[slot].x - points[i].x, y: points[slot].y - points[i].y };
  });
  return offsets;
}
