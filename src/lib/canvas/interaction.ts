import { anchorOf, edgeGeometry } from './edge-geometry';
import { rectOf } from './doc';
import { snapStepForScale, snapValue } from './grid';
import { expandWithGroupMembers } from './groups';
import { resolveSnap, type Guide, type SnapContext } from './snapping';
import type {
  CanvasDoc,
  CanvasEdge,
  CanvasNode,
  NodeSide,
  Point,
  Rect,
} from './types';
import { rectFromPoints } from './viewport';

/**
 * What the pointer is currently doing.
 *
 * Pure transitions, so the surface component stays a renderer rather than
 * becoming a six-hundred-line switch, and so the fiddly parts -- snapping
 * arbitration, group capture, which corner a resize is anchored to -- can be
 * reasoned about without a DOM.
 *
 * Everything is recomputed from the gesture's *origin* plus the total delta,
 * never accumulated frame to frame. A coalesced or dropped pointermove is then
 * simply a frame that did not render, rather than a permanent drift between
 * where the pointer is and where the content ended up.
 */

export type Handle = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw';

export type Interaction =
  | { kind: 'idle' }
  | { kind: 'pan'; startScreen: Point; startOffset: Point }
  | {
      kind: 'marquee';
      startCanvas: Point;
      currentCanvas: Point;
      /** The selection to add to, for a shift-drag. */
      base: ReadonlySet<string>;
    }
  | {
      kind: 'drag';
      startCanvas: Point;
      /** Everything moving: the selection plus every selected group's contents. */
      ids: readonly string[];
      origin: ReadonlyMap<string, Rect>;
      /** The node actually grabbed; the one whose edges snap. */
      primaryId: string;
      /**
       * What may be aligned to. Resolved once at drag start: recomputing it
       * per frame would let a group capture whatever it slid over, and would
       * let the moving nodes snap to each other.
       */
      neighbours: readonly Rect[];
      delta: Point;
      guides: readonly Guide[];
      /** Whether the pointer has travelled far enough to count as a drag. */
      moved: boolean;
    }
  | {
      kind: 'resize';
      id: string;
      handle: Handle;
      origin: Rect;
      rect: Rect;
      startCanvas: Point;
    }
  | {
      kind: 'edge';
      /**
       * The edge being re-attached, or null while drawing a new one.
       *
       * One state serves both because they are the same gesture: an end
       * follows the pointer, the other stays put, and dropping on a card
       * connects them. Only what happens on release differs.
       */
      edgeId: string | null;
      /** Which end follows the pointer. */
      movingEnd: 'from' | 'to';
      /** The end that stays put, and the side it is pinned to. */
      anchorNode: string;
      anchorSide: NodeSide | undefined;
      toPoint: Point;
      hoverNode: string | null;
      hoverSide: NodeSide | null;
      /**
       * Whether the pointer has travelled far enough to count as a drag.
       *
       * Load-bearing for re-attachment: an edge is grabbed by clicking the line
       * itself, and a line often crosses a card. Committing on a press that
       * never moved would silently reconnect an edge to whatever it happened to
       * be drawn over.
       */
      moved: boolean;
    };

export const IDLE: Interaction = { kind: 'idle' };

/**
 * Canvas units the pointer must travel before a press becomes a drag.
 *
 * Without it, a click that wobbles by one pixel commits a one-pixel move to
 * the file and to the undo stack.
 */
const DRAG_THRESHOLD = 3;

// -------------------------------------------------------------------- drag --

export function beginDrag(
  doc: CanvasDoc,
  selection: ReadonlySet<string>,
  primaryId: string,
  startCanvas: Point,
): Interaction {
  const moving = expandWithGroupMembers(selection, doc.nodes);

  const origin = new Map<string, Rect>();
  const neighbours: Rect[] = [];

  for (const node of doc.nodes) {
    if (moving.has(node.id)) origin.set(node.id, rectOf(node));
    else neighbours.push(rectOf(node));
  }

  return {
    kind: 'drag',
    startCanvas,
    ids: [...origin.keys()],
    origin,
    primaryId: origin.has(primaryId) ? primaryId : ([...origin.keys()][0] ?? primaryId),
    neighbours,
    delta: { x: 0, y: 0 },
    guides: [],
    moved: false,
  };
}

export function updateDrag(
  state: Extract<Interaction, { kind: 'drag' }>,
  canvasPoint: Point,
  context: SnapContext,
): Interaction {
  const raw = {
    x: canvasPoint.x - state.startCanvas.x,
    y: canvasPoint.y - state.startCanvas.y,
  };

  const moved =
    state.moved || Math.abs(raw.x) + Math.abs(raw.y) > DRAG_THRESHOLD;
  if (!moved) return state.moved === moved ? state : { ...state, moved };

  const primary = state.origin.get(state.primaryId);
  if (!primary) return { ...state, delta: raw, moved };

  // Only the grabbed node's own edges are snapped. Every other node in the
  // gesture then takes the *same* correction, so relative positions inside a
  // group or a multi-selection are preserved exactly.
  const { rect, guides } = resolveSnap(
    { ...primary, x: primary.x + raw.x, y: primary.y + raw.y },
    state.neighbours,
    context,
  );

  return {
    ...state,
    moved,
    delta: { x: rect.x - primary.x, y: rect.y - primary.y },
    guides,
  };
}

/** Where the dragged nodes currently sit. */
export function dragRects(
  state: Extract<Interaction, { kind: 'drag' }>,
): Map<string, Rect> {
  const rects = new Map<string, Rect>();
  for (const [id, rect] of state.origin) {
    rects.set(id, { ...rect, x: rect.x + state.delta.x, y: rect.y + state.delta.y });
  }
  return rects;
}

// ------------------------------------------------------------------ resize --

export function beginResize(
  doc: CanvasDoc,
  id: string,
  handle: Handle,
  startCanvas: Point,
): Interaction {
  const node = doc.nodes.find((candidate) => candidate.id === id);
  const origin = node ? rectOf(node) : { x: 0, y: 0, width: 0, height: 0 };

  return { kind: 'resize', id, handle, origin, rect: origin, startCanvas };
}

export function updateResize(
  state: Extract<Interaction, { kind: 'resize' }>,
  canvasPoint: Point,
  context: SnapContext,
): Interaction {
  const dx = canvasPoint.x - state.startCanvas.x;
  const dy = canvasPoint.y - state.startCanvas.y;
  const { x, y, width, height } = state.origin;

  // Each handle moves the edges named in it and leaves the opposite ones where
  // they are, which is what makes a resize feel anchored to the far corner.
  const west = state.handle.includes('w');
  const east = state.handle.includes('e');
  const north = state.handle.includes('n');
  const south = state.handle.includes('s');

  const step = context.enabled ? snapStepForScale(context.scale) : 0;
  const snap = (value: number) => (step ? snapValue(value, step) : value);

  /*
   * Snapped edge by edge, not as a whole rectangle.
   *
   * Snapping the rect meant dragging the *east* edge also snapped `x`, so a
   * card being made wider quietly slid sideways -- the one edge nobody was
   * touching was the one that moved. An edge that is not being dragged keeps
   * its original coordinate exactly.
   */
  let left = x;
  let right = x + width;
  let top = y;
  let bottom = y + height;

  if (west) left = snap(x + dx);
  if (east) right = snap(right + dx);
  if (north) top = snap(y + dy);
  if (south) bottom = snap(bottom + dy);

  // Dragging an edge past its opposite flips the rectangle inside out; folding
  // it back keeps the geometry positive without interrupting the gesture.
  if (right < left) [left, right] = [right, left];
  if (bottom < top) [top, bottom] = [bottom, top];

  return {
    ...state,
    rect: { x: left, y: top, width: right - left, height: bottom - top },
  };
}

// ----------------------------------------------------------------- marquee --

export function beginMarquee(
  startCanvas: Point,
  base: ReadonlySet<string>,
): Interaction {
  return { kind: 'marquee', startCanvas, currentCanvas: startCanvas, base };
}

export function marqueeRect(
  state: Extract<Interaction, { kind: 'marquee' }>,
): Rect {
  return rectFromPoints(state.startCanvas, state.currentCanvas);
}

// -------------------------------------------------------------------- edge --

const SIDES: readonly NodeSide[] = ['top', 'right', 'bottom', 'left'];

/** Screen pixels of reach around a node's port, converted by the caller. */
export const PORT_SNAP_PX = 28;

/** Drawing a new edge out of a card's port. */
export function beginEdge(
  fromNode: string,
  fromSide: NodeSide,
  at: Point,
): Interaction {
  return {
    kind: 'edge',
    edgeId: null,
    movingEnd: 'to',
    anchorNode: fromNode,
    anchorSide: fromSide,
    toPoint: at,
    hoverNode: null,
    hoverSide: null,
    // A new edge is dragged out of a port, so there is nothing under the
    // pointer to attach to by accident and no threshold to wait for.
    moved: true,
  };
}

/**
 * Moving one end of an edge that already exists.
 *
 * @param end Which end follows the pointer. The other becomes the anchor.
 */
export function beginEdgeReattach(
  edge: CanvasEdge,
  end: 'from' | 'to',
  at: Point,
): Interaction {
  return {
    kind: 'edge',
    edgeId: edge.id,
    movingEnd: end,
    anchorNode: end === 'from' ? edge.toNode : edge.fromNode,
    anchorSide: end === 'from' ? edge.toSide : edge.fromSide,
    toPoint: at,
    hoverNode: null,
    hoverSide: null,
    moved: false,
  };
}

/**
 * Which end of `edge` a press at `point` should pick up.
 *
 * Whichever endpoint is nearer, which is what the old implementation worked out
 * by sampling the curve and asking which half the press landed in. Comparing
 * the two endpoints directly gives the same answer everywhere it matters and
 * needs no sampling loop.
 */
export function closerEnd(
  from: Rect,
  to: Rect,
  edge: CanvasEdge,
  point: Point,
): 'from' | 'to' {
  const geometry = edgeGeometry(from, to, edge, edge.fromNode === edge.toNode);

  const toStart = Math.hypot(point.x - geometry.start.x, point.y - geometry.start.y);
  const toEnd = Math.hypot(point.x - geometry.end.x, point.y - geometry.end.y);

  return toStart <= toEnd ? 'from' : 'to';
}

/**
 * What an edge being drawn would connect to.
 *
 * Dropping *anywhere on* a card connects to it -- asking someone to hit a port
 * exactly is a needless test of aim. Near a port, that port wins and fixes the
 * side, which is how a deliberate choice is expressed.
 *
 * A card hit anywhere else returns a null side, and the edge is stored with no
 * `toSide` at all. The spec makes both sides optional, and leaving it out is
 * strictly better than guessing: `resolveSides` then picks the facing pair
 * every time the edge is drawn, so the connection still looks right after
 * either card is moved to the other side of the board.
 */
export function findEdgeTarget(
  nodes: readonly CanvasNode[],
  point: Point,
  excludeId: string,
  tolerance: number,
): { nodeId: string; side: NodeSide | null } | null {
  let nearestPort: { nodeId: string; side: NodeSide; distance: number } | null =
    null;

  for (const node of nodes) {
    if (node.id === excludeId) continue;
    const rect = rectOf(node);

    for (const side of SIDES) {
      const anchor = anchorOf(rect, side);
      const distance = Math.hypot(point.x - anchor.x, point.y - anchor.y);
      if (distance > tolerance) continue;
      if (nearestPort && distance >= nearestPort.distance) continue;
      nearestPort = { nodeId: node.id, side, distance };
    }
  }

  if (nearestPort) {
    return { nodeId: nearestPort.nodeId, side: nearestPort.side };
  }

  // Topmost first: later nodes paint over earlier ones, so a card dropped on
  // where two overlap should connect to the one actually visible there.
  for (let i = nodes.length - 1; i >= 0; i--) {
    const node = nodes[i];
    if (node.id === excludeId) continue;
    // Groups are regions, not cards; connecting to one by dropping anywhere
    // inside it would make every drop inside a group ambiguous.
    if (node.type === 'group') continue;

    const rect = rectOf(node);
    const inside =
      point.x >= rect.x &&
      point.x <= rect.x + rect.width &&
      point.y >= rect.y &&
      point.y <= rect.y + rect.height;
    if (!inside) continue;

    return { nodeId: node.id, side: null };
  }

  return null;
}

export function updateEdgeDraw(
  state: Extract<Interaction, { kind: 'edge' }>,
  point: Point,
  doc: CanvasDoc,
  tolerance: number,
): Interaction {
  const moved =
    state.moved ||
    Math.abs(point.x - state.toPoint.x) + Math.abs(point.y - state.toPoint.y) >
      DRAG_THRESHOLD;

  // The anchor is excluded so an edge cannot be collapsed onto its own other
  // end by accident, which is what the old implementation did too.
  const target = findEdgeTarget(doc.nodes, point, state.anchorNode, tolerance);

  return {
    ...state,
    moved,
    toPoint: point,
    hoverNode: target?.nodeId ?? null,
    hoverSide: target?.side ?? null,
  };
}
