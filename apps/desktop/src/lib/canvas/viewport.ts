import type { Point, Rect, Size } from './types';

/**
 * Screen <-> canvas coordinates, shared by the tab, the embedded preview and
 * the minimap.
 *
 * `offset` is the screen position of the content's origin, and content is
 * transformed about `0 0`, so the translation *is* the offset -- which is what
 * lets `CanvasGrid` read the same pair and land its dots on whole coordinates.
 */

export interface Viewport {
  scale: number;
  offset: Point;
}

export const MIN_SCALE = 0.05;
export const MAX_SCALE = 6;

/** Stops the zoom buttons step through, in even increments where it matters. */
export const ZOOM_STOPS = [
  0.05, 0.1, 0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4, 6,
] as const;

/**
 * Zoom per wheel event, by device. Keyed on the delta's sign only: scaling by
 * its magnitude makes every frame a different step, which the dot lattice
 * shows as jitter.
 */
export const TOUCHPAD_STEP = 1.03;
export const MOUSE_STEP = 1.2;

/** Below this delta the event came from a trackpad, not a wheel notch. */
export const TOUCHPAD_DELTA = 50;

/** Breathing room left around fitted content, so it never touches the edges. */
export const FIT_PADDING = 48;

export const IDENTITY_VIEWPORT: Viewport = { scale: 1, offset: { x: 0, y: 0 } };

function clampScale(scale: number): number {
  return Math.min(Math.max(scale, MIN_SCALE), MAX_SCALE);
}

/** A point in the pane's own pixel space to canvas coordinates. */
export function toCanvas(view: Viewport, paneX: number, paneY: number): Point {
  return {
    x: (paneX - view.offset.x) / view.scale,
    y: (paneY - view.offset.y) / view.scale,
  };
}

/** A canvas point back to the pane's pixel space. */
export function toScreen(view: Viewport, point: Point): Point {
  return {
    x: point.x * view.scale + view.offset.x,
    y: point.y * view.scale + view.offset.y,
  };
}

/** A client (viewport-relative) point to canvas coordinates. */
export function clientToCanvas(
  view: Viewport,
  clientX: number,
  clientY: number,
  box: DOMRect,
): Point {
  return toCanvas(view, clientX - box.left, clientY - box.top);
}

/**
 * Zooms about a point in the pane's pixel space. The content coordinate under
 * the pointer is what must not move; the offset follows from that.
 */
export function zoomAbout(
  view: Viewport,
  nextScale: number,
  paneX: number,
  paneY: number,
): Viewport {
  const scale = clampScale(nextScale);
  if (scale === view.scale) return view;

  const pointTo = toCanvas(view, paneX, paneY);

  return {
    scale,
    offset: {
      x: paneX - pointTo.x * scale,
      y: paneY - pointTo.y * scale,
    },
  };
}

/** The next stop above or below the current scale. */
export function stepScale(scale: number, direction: 1 | -1): number {
  // A tolerance, so landing on a stop does not make the next press a no-op.
  if (direction > 0) {
    return ZOOM_STOPS.find((stop) => stop > scale + 1e-4) ?? MAX_SCALE;
  }
  return (
    [...ZOOM_STOPS].reverse().find((stop) => stop < scale - 1e-4) ?? MIN_SCALE
  );
}

/** Centres `content` at the largest scale leaving `padding` clear. */
export function fitTo(
  content: Rect | null,
  pane: Size,
  padding = FIT_PADDING,
): Viewport {
  if (!content || !pane.width || !pane.height) return IDENTITY_VIEWPORT;

  // An empty-sized rect (a single zero-width node) would divide by zero.
  const width = Math.max(content.width, 1);
  const height = Math.max(content.height, 1);

  const scale = clampScale(
    Math.min(
      (pane.width - padding * 2) / width,
      (pane.height - padding * 2) / height,
      // Never zoom *in* to fit: a board with one small card should sit at 1:1
      // in the middle, not fill the pane with one enormous note.
      1,
    ),
  );

  return {
    scale,
    offset: {
      x: (pane.width - width * scale) / 2 - content.x * scale,
      y: (pane.height - height * scale) / 2 - content.y * scale,
    },
  };
}

/** The canvas-space rectangle currently visible in a pane of `size`. */
export function visibleRect(view: Viewport, pane: Size): Rect {
  const topLeft = toCanvas(view, 0, 0);
  const bottomRight = toCanvas(view, pane.width, pane.height);

  return {
    x: topLeft.x,
    y: topLeft.y,
    width: bottomRight.x - topLeft.x,
    height: bottomRight.y - topLeft.y,
  };
}

export function rectsIntersect(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

export function rectContains(outer: Rect, inner: Rect): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

/** Normalizes a drag between two points into a positive-extent rectangle. */
export function rectFromPoints(a: Point, b: Point): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(a.x - b.x),
    height: Math.abs(a.y - b.y),
  };
}
