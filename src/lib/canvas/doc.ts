import { createCanvasId } from './ids';
import {
  DEFAULT_NODE_SIZE,
  MIN_NODE_SIZE,
  type CanvasColor,
  type CanvasDoc,
  type CanvasEdge,
  type CanvasNode,
  type CanvasNodeType,
  type EdgeEnd,
  type Point,
  type Rect,
} from './types';

/**
 * Every operation a canvas document supports.
 *
 * Pure: each takes a `CanvasDoc` and returns a new one, sharing every object it
 * did not change. That is what makes the undo stack cheap enough to hold whole
 * snapshots -- an entry is a shallow array copy plus the handful of nodes that
 * actually moved -- and it keeps the store free of mutation bugs that only show
 * up after an undo.
 */

// ------------------------------------------------------------------ reading --

export function nodeMap(doc: CanvasDoc): Map<string, CanvasNode> {
  return new Map(doc.nodes.map((node) => [node.id, node]));
}

export function findNode(doc: CanvasDoc, id: string): CanvasNode | undefined {
  return doc.nodes.find((node) => node.id === id);
}

export function rectOf(node: CanvasNode): Rect {
  return { x: node.x, y: node.y, width: node.width, height: node.height };
}

/** The box every node fits inside, or null for an empty board. */
export function boundsOf(nodes: readonly CanvasNode[]): Rect | null {
  if (nodes.length === 0) return null;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const node of nodes) {
    minX = Math.min(minX, node.x);
    minY = Math.min(minY, node.y);
    maxX = Math.max(maxX, node.x + node.width);
    maxY = Math.max(maxY, node.y + node.height);
  }

  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export function boundsOfIds(doc: CanvasDoc, ids: Iterable<string>): Rect | null {
  const wanted = new Set(ids);
  return boundsOf(doc.nodes.filter((node) => wanted.has(node.id)));
}

/**
 * Whether an edge can actually be drawn.
 *
 * An edge naming a node the file no longer contains is kept in the document so
 * that opening a board is never destructive, which means every consumer that
 * draws has to filter for itself.
 */
export function isEdgeDrawable(
  edge: CanvasEdge,
  nodes: Map<string, CanvasNode>,
): boolean {
  return nodes.has(edge.fromNode) && nodes.has(edge.toNode);
}

// ------------------------------------------------------------------ writing --

/** A new node of `type`, positioned by its top-left corner. */
export function createNode(
  type: Exclude<CanvasNodeType, 'unknown'>,
  at: Point,
  overrides: Partial<CanvasNode> = {},
): CanvasNode {
  const size = DEFAULT_NODE_SIZE[type];
  const base = {
    id: createCanvasId(),
    x: Math.round(at.x),
    y: Math.round(at.y),
    width: size.width,
    height: size.height,
  };

  switch (type) {
    case 'text':
      return { ...base, type: 'text', text: '', ...overrides } as CanvasNode;
    case 'file':
      return { ...base, type: 'file', file: '', ...overrides } as CanvasNode;
    case 'link':
      return { ...base, type: 'link', url: '', ...overrides } as CanvasNode;
    case 'group':
      return { ...base, type: 'group', ...overrides } as CanvasNode;
  }
}

export function addNode(doc: CanvasDoc, node: CanvasNode): CanvasDoc {
  return { ...doc, nodes: [...doc.nodes, node] };
}

/**
 * Applies `change` to one node.
 *
 * Typed as a callback rather than a patch object so callers narrowing on
 * `node.type` keep their narrowing -- a `Partial<CanvasNode>` patch would let
 * `text` be set on a group node.
 */
export function updateNode(
  doc: CanvasDoc,
  id: string,
  change: (node: CanvasNode) => CanvasNode,
): CanvasDoc {
  let changed = false;
  const nodes = doc.nodes.map((node) => {
    if (node.id !== id) return node;
    changed = true;
    return change(node);
  });

  // Returning the same object when nothing matched keeps a no-op out of the
  // undo stack and out of the autosaver.
  return changed ? { ...doc, nodes } : doc;
}

/** Moves many nodes by one delta. The shape of every drag. */
export function moveNodes(
  doc: CanvasDoc,
  ids: ReadonlySet<string>,
  delta: Point,
): CanvasDoc {
  if (ids.size === 0 || (delta.x === 0 && delta.y === 0)) return doc;

  return {
    ...doc,
    nodes: doc.nodes.map((node) =>
      ids.has(node.id)
        ? { ...node, x: node.x + delta.x, y: node.y + delta.y }
        : node,
    ),
  };
}

/** Places nodes at absolute rects. Used by drag and resize, which recompute
 *  from the gesture's start rather than accumulating per-frame deltas. */
export function placeNodes(
  doc: CanvasDoc,
  rects: ReadonlyMap<string, Rect>,
): CanvasDoc {
  if (rects.size === 0) return doc;

  return {
    ...doc,
    nodes: doc.nodes.map((node) => {
      const rect = rects.get(node.id);
      if (!rect) return node;
      return {
        ...node,
        x: rect.x,
        y: rect.y,
        width: Math.max(rect.width, MIN_NODE_SIZE.width),
        height: Math.max(rect.height, MIN_NODE_SIZE.height),
      };
    }),
  };
}

/**
 * Deletes nodes together with every edge that touched them.
 *
 * Leaving the edges behind would be the more literal reading of "delete these
 * nodes", but it accumulates invisible cruft in the file: those edges are
 * unrenderable and there is no UI that could ever reach them again.
 */
export function removeNodes(doc: CanvasDoc, ids: ReadonlySet<string>): CanvasDoc {
  if (ids.size === 0) return doc;

  return {
    ...doc,
    nodes: doc.nodes.filter((node) => !ids.has(node.id)),
    edges: doc.edges.filter(
      (edge) => !ids.has(edge.fromNode) && !ids.has(edge.toNode),
    ),
  };
}

/** Deletes by id across both collections, which is what a selection holds. */
export function removeSelection(
  doc: CanvasDoc,
  ids: ReadonlySet<string>,
): CanvasDoc {
  if (ids.size === 0) return doc;
  const withoutNodes = removeNodes(doc, ids);
  return {
    ...withoutNodes,
    edges: withoutNodes.edges.filter((edge) => !ids.has(edge.id)),
  };
}

export function addEdge(doc: CanvasDoc, edge: CanvasEdge): CanvasDoc {
  return { ...doc, edges: [...doc.edges, edge] };
}

export function updateEdge(
  doc: CanvasDoc,
  id: string,
  patch: Partial<CanvasEdge>,
): CanvasDoc {
  let changed = false;
  const edges = doc.edges.map((edge) => {
    if (edge.id !== id) return edge;
    changed = true;
    return { ...edge, ...patch };
  });

  return changed ? { ...doc, edges } : doc;
}

/**
 * Sets which ends of the selected edges carry an arrowhead.
 *
 * `undefined` for either end leaves it alone, so a single call can change just
 * one end without having to read the other back first. Applied to every edge
 * in `ids` in one pass, so a multi-edge change is one history entry rather
 * than one per edge.
 */
export function setEdgeEnds(
  doc: CanvasDoc,
  ids: ReadonlySet<string>,
  ends: { fromEnd?: EdgeEnd; toEnd?: EdgeEnd },
): CanvasDoc {
  if (ids.size === 0) return doc;

  return {
    ...doc,
    edges: doc.edges.map((edge) =>
      ids.has(edge.id)
        ? {
            ...edge,
            fromEnd: ends.fromEnd ?? edge.fromEnd,
            toEnd: ends.toEnd ?? edge.toEnd,
          }
        : edge,
    ),
  };
}

/** Sets or clears the colour of everything selected, nodes and edges alike. */
export function setColor(
  doc: CanvasDoc,
  ids: ReadonlySet<string>,
  color: CanvasColor | undefined,
): CanvasDoc {
  if (ids.size === 0) return doc;

  return {
    ...doc,
    nodes: doc.nodes.map((node) =>
      ids.has(node.id) ? { ...node, color } : node,
    ),
    edges: doc.edges.map((edge) =>
      ids.has(edge.id) ? { ...edge, color } : edge,
    ),
  };
}

export function setNodeText(
  doc: CanvasDoc,
  id: string,
  text: string,
): CanvasDoc {
  return updateNode(doc, id, (node) =>
    node.type === 'text' && node.text !== text ? { ...node, text } : node,
  );
}

/**
 * Raises nodes to the end of the array.
 *
 * Paint order *is* array order, so the file already records the stacking and
 * there is no separate z-index to keep in sync. Relative order among the moved
 * nodes is preserved.
 */
export function bringToFront(
  doc: CanvasDoc,
  ids: ReadonlySet<string>,
): CanvasDoc {
  if (ids.size === 0) return doc;

  const staying = doc.nodes.filter((node) => !ids.has(node.id));
  const rising = doc.nodes.filter((node) => ids.has(node.id));
  if (rising.length === 0) return doc;

  return { ...doc, nodes: [...staying, ...rising] };
}

export function sendToBack(doc: CanvasDoc, ids: ReadonlySet<string>): CanvasDoc {
  if (ids.size === 0) return doc;

  const sinking = doc.nodes.filter((node) => ids.has(node.id));
  const staying = doc.nodes.filter((node) => !ids.has(node.id));
  if (sinking.length === 0) return doc;

  return { ...doc, nodes: [...sinking, ...staying] };
}

/**
 * Renames a group or an edge.
 *
 * One function for both because the selection is one id and the caller does not
 * otherwise care which it is. An empty name removes the key rather than writing
 * `""` -- the spec has the field optional, and a board that round-trips through
 * a rename and back should be byte-identical to the one that started.
 */
export function setLabel(
  doc: CanvasDoc,
  id: string,
  label: string,
): CanvasDoc {
  const next = label.trim() === '' ? undefined : label;

  if (doc.nodes.some((node) => node.id === id)) {
    return updateNode(doc, id, (node) =>
      node.type === 'group' && node.label !== next
        ? { ...node, label: next }
        : node,
    );
  }

  return updateEdge(doc, id, { label: next });
}
