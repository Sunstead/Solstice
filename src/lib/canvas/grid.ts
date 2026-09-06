/**
 * The dot lattice, shared by the code that draws it and the code that snaps to
 * it. These must stay one function: a separate snap step would put nodes
 * between the dots at some zoom levels and on them at others.
 */

/** Screen spacing the dots aim for; the cell is snapped to a power of two. */
const TARGET_SPACING = 30;

/** Without a clamp the step follows the lattice out to 256 units at 10% zoom. */
const MIN_CELL = 8;
const MAX_CELL = 64;

/**
 * The lattice cell in canvas units at a given zoom. Powers of two make zooming
 * subdivide -- existing dots survive and new ones appear between them -- and
 * `Math.min(scale, 1)` stops that above 1:1.
 */
export function gridCellForScale(scale: number): number {
  return 2 ** Math.round(Math.log2(TARGET_SPACING / Math.min(scale, 1)));
}

/**
 * The step a drag snaps to: the same number the dots are drawn at, clamped.
 * Granularity therefore depends on zoom, which is what the alignment guides
 * cover.
 */
export function snapStepForScale(scale: number): number {
  return Math.min(Math.max(gridCellForScale(scale), MIN_CELL), MAX_CELL);
}

export function snapValue(value: number, step: number): number {
  return Math.round(value / step) * step;
}
