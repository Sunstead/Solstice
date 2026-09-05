import { snapStepForScale, snapValue } from './grid';
import type { Rect } from './types';

/**
 * Where a dragged rectangle actually lands.
 *
 * Two things want to correct the same number: the dot grid, and alignment with
 * whatever else is on the board. Rather than layering one on the other -- which
 * makes them fight, and makes which one won depend on the order they ran -- they
 * are treated as two candidates for the same correction, arbitrated per axis,
 * closest wins.
 *
 * Ties go to the guide. A guide is a deliberate relationship with a visible
 * object; the grid is background convenience, and being pulled off a neighbour's
 * edge by half a pixel of grid is the more annoying failure.
 */

export interface Guide {
  axis: 'x' | 'y';
  /** Canvas coordinate of the line. */
  at: number;
  /** Canvas-space extent, so the line spans the objects it relates. */
  from: number;
  to: number;
}

/** How close, in *screen* pixels, a guide has to be to take hold. */
const SNAP_PX = 6;

export interface SnapContext {
  scale: number;
  /** False while Alt/Cmd is held, or when the setting is off. */
  enabled: boolean;
}

/**
 * The three values on an axis a rectangle can align by: leading edge, centre,
 * trailing edge. Compared *pairwise* -- leading to leading, centre to centre,
 * trailing to trailing.
 *
 * Comparing every value against every other was the obvious first cut and is
 * wrong: it matches a dragged card's right edge to a neighbour's left edge, so
 * anything passing within a few units of another card gets glued to it edge to
 * edge. Butting two cards together is a real thing to want, but it is not what
 * an alignment guide means, and at this tolerance it hijacked ordinary drags.
 */
function referencesX(rect: Rect): number[] {
  return [rect.x, rect.x + rect.width / 2, rect.x + rect.width];
}

function referencesY(rect: Rect): number[] {
  return [rect.y, rect.y + rect.height / 2, rect.y + rect.height];
}

interface Candidate {
  /** How far the rectangle has to move to take it. */
  cost: number;
  correction: number;
  /** The neighbour's coordinate, for drawing. Absent for a grid snap. */
  at?: number;
  from?: number;
  to?: number;
}

function bestGuide(
  moved: number[],
  neighbours: readonly Rect[],
  references: (rect: Rect) => number[],
  extent: (rect: Rect) => [number, number],
  tolerance: number,
): Candidate | null {
  let best: Candidate | null = null;

  for (const neighbour of neighbours) {
    const targets = references(neighbour);

    for (let i = 0; i < moved.length; i++) {
      const correction = targets[i] - moved[i];
      const cost = Math.abs(correction);
      if (cost > tolerance) continue;
      if (best && cost >= best.cost) continue;

      const [from, to] = extent(neighbour);
      best = { cost, correction, at: targets[i], from, to };
    }
  }

  return best;
}

export interface SnapResult {
  rect: Rect;
  guides: Guide[];
}

/**
 * @param moved The rectangle as the pointer would place it, unsnapped.
 * @param neighbours Everything it may align to. Must exclude the rest of the
 *   selection: nodes moving together would otherwise snap to each other and
 *   the whole group would seize up.
 */
export function resolveSnap(
  moved: Rect,
  neighbours: readonly Rect[],
  context: SnapContext,
): SnapResult {
  if (!context.enabled) return { rect: moved, guides: [] };

  const step = snapStepForScale(context.scale);
  // A screen-pixel threshold converted to canvas units, so snapping feels
  // identical at every zoom rather than getting stickier as you zoom out.
  const tolerance = SNAP_PX / context.scale;

  const guides: Guide[] = [];

  const resolveAxis = (
    gridCorrection: number,
    guide: Candidate | null,
    axis: 'x' | 'y',
  ): number => {
    const gridCost = Math.abs(gridCorrection);

    // `<=` so a tie goes to the guide.
    if (guide && guide.cost <= gridCost) {
      guides.push({
        axis,
        at: guide.at!,
        from: guide.from!,
        to: guide.to!,
      });
      return guide.correction;
    }

    return gridCorrection;
  };

  const gridX = snapValue(moved.x, step) - moved.x;
  const gridY = snapValue(moved.y, step) - moved.y;

  const guideX = bestGuide(
    referencesX(moved),
    neighbours,
    referencesX,
    (rect) => [rect.y, rect.y + rect.height],
    tolerance,
  );
  const guideY = bestGuide(
    referencesY(moved),
    neighbours,
    referencesY,
    (rect) => [rect.x, rect.x + rect.width],
    tolerance,
  );

  const dx = resolveAxis(gridX, guideX, 'x');
  const dy = resolveAxis(gridY, guideY, 'y');

  // Guides are drawn against the rectangle's *final* position, so the line
  // spans both the neighbour and the thing that just aligned to it.
  const rect = { ...moved, x: moved.x + dx, y: moved.y + dy };

  for (const guide of guides) {
    if (guide.axis === 'x') {
      guide.from = Math.min(guide.from, rect.y);
      guide.to = Math.max(guide.to, rect.y + rect.height);
    } else {
      guide.from = Math.min(guide.from, rect.x);
      guide.to = Math.max(guide.to, rect.x + rect.width);
    }
  }

  return { rect, guides };
}
