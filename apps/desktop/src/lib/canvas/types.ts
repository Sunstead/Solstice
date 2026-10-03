/**
 * The JSON Canvas 1.0 document model: https://jsoncanvas.org/spec/1.0/
 *
 * Key names mirror the spec because these objects are written back to a file
 * other applications read -- a rename here is a compatibility break, not a
 * refactor.
 */

/**
 * A hex string (`"#FF0000"`) or a preset index `"1"`..`"6"`. Plain `string`
 * because a file can hold anything; `resolveCanvasColor` parts the two forms.
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
   * Every key the spec does not define, kept verbatim so a board written by a
   * newer Obsidian or by a plugin survives a round trip untouched.
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
 * A node whose `type` this version does not recognise. Discriminated as
 * `'unknown'` with the file's own string parked in `unknownType`, so the union
 * stays exhaustively switchable; geometry stays editable and the payload is
 * echoed back on write.
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

/** The spec's defaults, asymmetric: an edge points at its target. */
export const DEFAULT_FROM_END: EdgeEnd = 'none';
export const DEFAULT_TO_END: EdgeEnd = 'arrow';

/**
 * Sizes for new cards, and the repair value for a node that arrives without
 * one. Matches what Obsidian creates.
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
