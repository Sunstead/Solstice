/**
 * The JSON Canvas 1.0 document model.
 *
 * https://jsoncanvas.org/spec/1.0/
 *
 * Types only -- the vocabulary every other module in `lib/canvas` speaks. The
 * shapes deliberately mirror the spec's own key names rather than improving on
 * them, because these objects are written back to a file other applications
 * read: a rename here is a compatibility break, not a refactor.
 */

/**
 * A hex string (`"#FF0000"`) or one of the six preset indices `"1"`..`"6"`
 * (red, orange, yellow, green, cyan, purple).
 *
 * Left as a plain `string` rather than a union: the spec allows any hex value,
 * and narrowing the presets would not stop an arbitrary one arriving from a
 * file anyway. `resolveCanvasColor` in `color.ts` is where the two forms part.
 */
export type CanvasColor = string;

export type NodeSide = 'top' | 'right' | 'bottom' | 'left';
export type EdgeEnd = 'none' | 'arrow';
export type BackgroundStyle = 'cover' | 'ratio' | 'repeat';

export interface Point {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface Rect extends Point, Size {}

interface BaseNode extends Rect {
  id: string;
  color?: CanvasColor;
  /**
   * Every key the spec does not define, kept verbatim.
   *
   * The same forward-compatibility contract the settings files hold: a board
   * written by a newer Obsidian, or by a plugin, has to survive a round trip
   * through this editor untouched. Anything we do not understand is data we
   * are holding on someone else's behalf, not noise to discard.
   */
  extra?: Record<string, unknown>;
}

/** Markdown held inline in the canvas file rather than in a note of its own. */
export type TextNode = BaseNode & { type: 'text'; text: string };

/** A workspace file, by a path relative to the vault root. */
export type FileNode = BaseNode & {
  type: 'file';
  file: string;
  /** A heading or block reference. Always starts with `#`. */
  subpath?: string;
};

export type LinkNode = BaseNode & { type: 'link'; url: string };

export type GroupNode = BaseNode & {
  type: 'group';
  label?: string;
  background?: string;
  backgroundStyle?: BackgroundStyle;
};

/**
 * A node whose `type` this version does not recognise.
 *
 * Discriminated as `'unknown'` with the file's own string parked in
 * `unknownType`, so the union stays exhaustively switchable -- a bare
 * `type: string` member would swallow every other branch. Geometry stays
 * editable and the payload is echoed back on write, so an unrecognised card
 * can still be moved out of the way without corrupting whatever wrote it.
 */
export type UnknownNode = BaseNode & { type: 'unknown'; unknownType: string };

export type CanvasNode =
  | TextNode
  | FileNode
  | LinkNode
  | GroupNode
  | UnknownNode;

export type CanvasNodeType = CanvasNode['type'];

export interface CanvasEdge {
  id: string;
  fromNode: string;
  fromSide?: NodeSide;
  fromEnd?: EdgeEnd;
  toNode: string;
  toSide?: NodeSide;
  toEnd?: EdgeEnd;
  color?: CanvasColor;
  label?: string;
  extra?: Record<string, unknown>;
}

export interface CanvasDoc {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  /** Top-level keys other than `nodes`/`edges`, preserved verbatim. */
  extra: Record<string, unknown>;
}

export const EMPTY_DOC: CanvasDoc = { nodes: [], edges: [], extra: {} };

/**
 * The spec's own defaults for the ends of an edge, which are asymmetric: an
 * edge points *at* its target unless told otherwise.
 */
export const DEFAULT_FROM_END: EdgeEnd = 'none';
export const DEFAULT_TO_END: EdgeEnd = 'arrow';

/**
 * Sizes for newly created cards, and the repair value for a node that arrives
 * without one. Chosen to match what Obsidian creates, so a board built here
 * and a board built there look like the same kind of object.
 */
export const DEFAULT_NODE_SIZE: Record<CanvasNodeType, Size> = {
  text: { width: 250, height: 60 },
  file: { width: 400, height: 400 },
  link: { width: 400, height: 400 },
  group: { width: 400, height: 400 },
  unknown: { width: 250, height: 60 },
};

/** Nothing smaller is grabbable, let alone readable. */
export const MIN_NODE_SIZE: Size = { width: 40, height: 40 };
