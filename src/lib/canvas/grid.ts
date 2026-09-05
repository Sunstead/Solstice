/**
 * The dot lattice, shared by the thing that draws it and the thing that snaps
 * to it.
 *
 * These have to be one function. If snapping computed its own step, the dots
 * on screen and the positions nodes land on would agree at some zoom levels
 * and not others -- the kind of bug that reads as "snapping is broken" without
 * ever being reproducible at the zoom the reporter was using.
 */

/** Screen spacing the dots aim for; the cell is snapped to a power of two. */
export const TARGET_SPACING = 30;

/**
 * Bounds on the snap step in canvas units.
 *
 * Unclamped, the step follows the visible lattice all the way out, so at 10%
 * zoom a node would jump 256 units at a time. Clamping trades the "always land
 * on a dot" promise at the extremes for placement that stays usable there.
 */
const MIN_CELL = 8;
const MAX_CELL = 64;

/**
 * The lattice cell in canvas units at a given zoom.
 *
 * Snapping to a power of two makes zooming *subdivide*: each cell is half the
 * last, so existing dots survive and new ones appear between them. The
 * `Math.min(scale, 1)` stops that above 1:1, where a subdivision would reveal
 * half the dots at once.
 */
export function gridCellForScale(scale: number): number {
  return 2 ** Math.round(Math.log2(TARGET_SPACING / Math.min(scale, 1)));
}

/**
 * The step a drag snaps to at a given zoom.
 *
 * Deliberately the same number the dots are drawn at, clamped: "snap to the
 * dots" is then literally true through the working range, and zooming in for
 * finer placement is a real technique rather than folklore. The cost is that
 * placement granularity depends on zoom level, which is exactly what the
 * alignment guides are there to cover.
 */
export function snapStepForScale(scale: number): number {
  return Math.min(Math.max(gridCellForScale(scale), MIN_CELL), MAX_CELL);
}

export function snapValue(value: number, step: number): number {
  return Math.round(value / step) * step;
}
