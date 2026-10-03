import {
  DEFAULT_FROM_END,
  DEFAULT_TO_END,
  type CanvasEdge,
  type EdgeEnd,
  type NodeSide,
  type Point,
  type Rect,
} from './types';

/**
 * Where an edge is drawn. Coordinate-system agnostic: hand it two rects and it
 * returns a path in the same space.
 *
 * The renderer passes screen-space rects, since drawing inside the zoom
 * transform would scale stroke widths into ribbons at 4x and hairlines at
 * 0.1x, and every fix for that is another special case.
 */

export interface EdgeGeometry {
  /** An SVG cubic path, `M … C …`. */
  d: string;
  start: Point;
  end: Point;
  fromSide: NodeSide;
  toSide: NodeSide;
  /** Radians, pointing the way the arrow glyph should face. */
  startAngle: number;
  endAngle: number;
  /** The curve at t=0.5, where a label sits. */
  mid: Point;
}

const SIDES: readonly NodeSide[] = ['top', 'right', 'bottom', 'left'];

/** Unit vector pointing out of a node through the given side. */
const OUTWARD: Record<NodeSide, Point> = {
  top: { x: 0, y: -1 },
  right: { x: 1, y: 0 },
  bottom: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
};

/**
 * Enough to outweigh any plausible distance, so a side facing away from the
 * target is never chosen over one facing it however close it happens to sit.
 */
const BACKWARD_PENALTY = 100_000;

/**
 * How far a control point is pushed out of its anchor, in *canvas* units.
 * Callers working in screen space must scale these, or the clamp bites at a
 * different point at every zoom and the curve changes shape as you zoom.
 */
const MIN_CURVE = 24;
const MAX_CURVE = 160;
const CURVE_RATIO = 0.4;

export function anchorOf(rect: Rect, side: NodeSide): Point {
  switch (side) {
    case 'top':
      return { x: rect.x + rect.width / 2, y: rect.y };
    case 'bottom':
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height };
    case 'left':
      return { x: rect.x, y: rect.y + rect.height / 2 };
    case 'right':
      return { x: rect.x + rect.width, y: rect.y + rect.height / 2 };
  }
}

function distance(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/**
 * Picks the sides the file left unspecified: the shortest pair of anchors, but
 * only among sides facing the other node. Without the penalty an edge between
 * two close nodes leaves through the back and loops around.
 */
export function resolveSides(
  from: Rect,
  to: Rect,
  fromSide: NodeSide | undefined,
  toSide: NodeSide | undefined,
): { fromSide: NodeSide; toSide: NodeSide } {
  if (fromSide && toSide) return { fromSide, toSide };

  const fromCandidates = fromSide ? [fromSide] : SIDES;
  const toCandidates = toSide ? [toSide] : SIDES;

  let best: { fromSide: NodeSide; toSide: NodeSide } | null = null;
  let bestScore = Infinity;

  for (const a of fromCandidates) {
    const anchorA = anchorOf(from, a);
    for (const b of toCandidates) {
      const anchorB = anchorOf(to, b);

      const toward = { x: anchorB.x - anchorA.x, y: anchorB.y - anchorA.y };
      const outA = OUTWARD[a];
      const outB = OUTWARD[b];

      let score = distance(anchorA, anchorB);
      if (outA.x * toward.x + outA.y * toward.y < 0) score += BACKWARD_PENALTY;
      if (outB.x * -toward.x + outB.y * -toward.y < 0) score += BACKWARD_PENALTY;

      if (score < bestScore) {
        bestScore = score;
        best = { fromSide: a, toSide: b };
      }
    }
  }

  return best ?? { fromSide: 'right', toSide: 'left' };
}

export function edgeGeometry(
  from: Rect,
  to: Rect,
  edge: Pick<CanvasEdge, 'fromSide' | 'toSide'>,
  /** True when both ends are the same node, which needs distinct anchors. */
  selfEdge = false,
  /**
   * The zoom the rects were projected at, so the curve's shape does not depend
   * on it. Defaults to 1 for callers already working in canvas units.
   */
  scale = 1,
): EdgeGeometry {
  const sides = selfEdge
    ? {
        fromSide: edge.fromSide ?? 'right',
        toSide: edge.toSide ?? 'bottom',
      }
    : resolveSides(from, to, edge.fromSide, edge.toSide);
  const { fromSide } = sides;
  let { toSide } = sides;

  // Both anchors in one place would give no curve at all; a quarter turn
  // reuses the ordinary bezier rather than adding a second path builder.
  if (selfEdge && fromSide === toSide) {
    toSide = SIDES[(SIDES.indexOf(fromSide) + 1) % SIDES.length];
  }

  const start = anchorOf(from, fromSide);
  const end = anchorOf(to, toSide);

  const span = distance(start, end);
  // A self-edge's anchors are close by construction, so scaling off their
  // distance would collapse the loop; use the node's own size instead.
  const reach = selfEdge
    ? Math.max(from.width, from.height) * 0.5
    : Math.min(
        Math.max(span * CURVE_RATIO, MIN_CURVE * scale),
        MAX_CURVE * scale,
      );

  const outFrom = OUTWARD[fromSide];
  const outTo = OUTWARD[toSide];

  const c1 = { x: start.x + outFrom.x * reach, y: start.y + outFrom.y * reach };
  const c2 = { x: end.x + outTo.x * reach, y: end.y + outTo.y * reach };

  return {
    d: `M ${start.x} ${start.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${end.x} ${end.y}`,
    start,
    end,
    fromSide,
    toSide,
    // The tangent points along the control leg: exact, and free.
    startAngle: Math.atan2(start.y - c1.y, start.x - c1.x),
    endAngle: Math.atan2(end.y - c2.y, end.x - c2.x),
    // A cubic at t=0.5 reduces to this.
    mid: {
      x: (start.x + 3 * c1.x + 3 * c2.x + end.x) / 8,
      y: (start.y + 3 * c1.y + 3 * c2.y + end.y) / 8,
    },
  };
}

/** The spec's defaults are asymmetric: an edge points *at* its target. */
export function fromEndOf(edge: CanvasEdge): EdgeEnd {
  return edge.fromEnd ?? DEFAULT_FROM_END;
}

export function toEndOf(edge: CanvasEdge): EdgeEnd {
  return edge.toEnd ?? DEFAULT_TO_END;
}

/**
 * An arrowhead as an SVG polygon path. Hand-drawn rather than a `<marker>`:
 * one code path serves both ends, sized in the caller's own units, with no
 * `<defs>` entry to mint per colour.
 */
export function arrowPath(at: Point, angle: number, size: number): string {
  const spread = Math.PI / 7;
  const back = angle + Math.PI;

  const left = {
    x: at.x + Math.cos(back - spread) * size,
    y: at.y + Math.sin(back - spread) * size,
  };
  const right = {
    x: at.x + Math.cos(back + spread) * size,
    y: at.y + Math.sin(back + spread) * size,
  };

  return `M ${at.x} ${at.y} L ${left.x} ${left.y} L ${right.x} ${right.y} Z`;
}
