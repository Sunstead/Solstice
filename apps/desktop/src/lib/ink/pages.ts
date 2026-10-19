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
