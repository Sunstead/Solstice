import { createCanvasId } from './ids';
import {
  DEFAULT_NODE_SIZE,
  type BackgroundStyle,
  type CanvasDoc,
  type CanvasEdge,
  type CanvasNode,
  type CanvasNodeType,
  type EdgeEnd,
  type NodeSide,
} from './types';

/**
 * Reading a `.canvas` file, under two rules.
 *
 * **Never throw:** a tab that crashes on a malformed board cannot show what is
 * wrong with it. **Never discard:** unrecognised keys are carried through to
 * `extra` and written back out. The only exceptions are values replaced to
 * make the document usable at all -- a missing id, non-finite geometry -- and
 * each of those is logged.
 */

export type ParseResult =
  /** A well-formed board. */
  | { status: 'ok'; doc: CanvasDoc; indent: string }
  /** A zero-byte or whitespace-only file, which is an empty board. */
  | { status: 'empty'; doc: CanvasDoc; indent: string }
  /**
   * Not a canvas. Carries the original text so the tab can show it and offer a
   * way out without ever writing over it.
   */
  | { status: 'invalid'; message: string; raw: string };

const NODE_SIDES: readonly string[] = ['top', 'right', 'bottom', 'left'];
const EDGE_ENDS: readonly string[] = ['none', 'arrow'];
const BACKGROUND_STYLES: readonly string[] = ['cover', 'ratio', 'repeat'];
const KNOWN_TYPES: readonly string[] = ['text', 'file', 'link', 'group'];

/** What this app writes, and the fallback for a file with nothing to copy. */
export const DEFAULT_INDENT = '  ';

/**
 * The indentation the file already uses. Obsidian and this app disagree on
 * width, and a board edited in both would otherwise rewrite every line on
 * every save.
 */
function detectIndent(text: string): string {
  const match = /\n([ \t]+)"/.exec(text);
  if (!match) return DEFAULT_INDENT;
  return match[1].startsWith('\t') ? '\t' : match[1];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' && value !== null && !Array.isArray(value)
  );
}

/**
 * Consumes a key, so what is left over is exactly what this parser did not
 * understand. Taking rather than reading makes preservation the default.
 */
function take(rest: Record<string, unknown>, key: string): unknown {
  const value = rest[key];
  delete rest[key];
  return value;
}

function takeString(
  rest: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = rest[key];
  if (typeof value !== 'string') return undefined;
  delete rest[key];
  return value;
}

/**
 * Takes a value only when it is one of `allowed`. A side of `"north"` stays in
 * `extra`, so geometry code can trust the type and the odd value still round
 * trips.
 */
function takeEnum<T extends string>(
  rest: Record<string, unknown>,
  key: string,
  allowed: readonly string[],
): T | undefined {
  const value = rest[key];
  if (typeof value !== 'string' || !allowed.includes(value)) return undefined;
  delete rest[key];
  return value as T;
}

function takeFinite(
  rest: Record<string, unknown>,
  key: string,
): number | undefined {
  const value = rest[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  delete rest[key];
  return value;
}

/** `extra` stays absent rather than empty, so a clean node serializes clean. */
function leftovers(
  rest: Record<string, unknown>,
): Record<string, unknown> | undefined {
  return Object.keys(rest).length > 0 ? rest : undefined;
}

function parseNode(raw: unknown, index: number): CanvasNode | null {
  if (!isPlainObject(raw)) {
    console.warn(`[canvas] node ${index} is not an object; dropped`);
    return null;
  }

  const rest = { ...raw };

  let id = takeString(rest, 'id');
  if (id === undefined || id === '') {
    // A node with no id cannot be selected, moved or referenced by an edge.
    id = createCanvasId();
    console.warn(`[canvas] node ${index} has no id; assigned ${id}`);
  }

  // Any string `type` is consumed: recognised ones discriminate the node,
  // unrecognised ones are parked in `unknownType`. A non-string `type` is left
  // in `extra`, there being nowhere better for it.
  const rawType = rest.type;
  if (typeof rawType === 'string') delete rest.type;

  const known =
    typeof rawType === 'string' && KNOWN_TYPES.includes(rawType)
      ? (rawType as Exclude<CanvasNodeType, 'unknown'>)
      : null;

  const type: CanvasNodeType = known ?? 'unknown';
  const fallback = DEFAULT_NODE_SIZE[type];

  const x = takeFinite(rest, 'x') ?? 0;
  const y = takeFinite(rest, 'y') ?? 0;
  const width = takeFinite(rest, 'width');
  const height = takeFinite(rest, 'height');

  const base = {
    id,
    x,
    y,
    width: width !== undefined && width > 0 ? width : fallback.width,
    height: height !== undefined && height > 0 ? height : fallback.height,
    color: takeString(rest, 'color'),
  };

  switch (known) {
    case 'text':
      return {
        ...base,
        type: 'text',
        text: takeString(rest, 'text') ?? '',
        extra: leftovers(rest),
      };

    case 'file':
      return {
        ...base,
        type: 'file',
        file: takeString(rest, 'file') ?? '',
        subpath: takeString(rest, 'subpath'),
        extra: leftovers(rest),
      };

    case 'link':
      return {
        ...base,
        type: 'link',
        url: takeString(rest, 'url') ?? '',
        extra: leftovers(rest),
      };

    case 'group':
      return {
        ...base,
        type: 'group',
        label: takeString(rest, 'label'),
        background: takeString(rest, 'background'),
        backgroundStyle: takeEnum<BackgroundStyle>(
          rest,
          'backgroundStyle',
          BACKGROUND_STYLES,
        ),
        extra: leftovers(rest),
      };

    default:
      return {
        ...base,
        type: 'unknown',
        // Empty when `type` was absent or not a string; the odd value, if
        // any, is in `extra` and written from there.
        unknownType: typeof rawType === 'string' ? rawType : '',
        extra: leftovers(rest),
      };
  }
}

function parseEdge(raw: unknown, index: number): CanvasEdge | null {
  if (!isPlainObject(raw)) {
    console.warn(`[canvas] edge ${index} is not an object; dropped`);
    return null;
  }

  const rest = { ...raw };

  let id = takeString(rest, 'id');
  if (id === undefined || id === '') {
    id = createCanvasId();
    console.warn(`[canvas] edge ${index} has no id; assigned ${id}`);
  }

  return {
    id,
    // An edge naming a missing node is kept, not dropped: the node may come
    // back on the next external edit. The renderer skips it.
    fromNode: takeString(rest, 'fromNode') ?? '',
    fromSide: takeEnum<NodeSide>(rest, 'fromSide', NODE_SIDES),
    fromEnd: takeEnum<EdgeEnd>(rest, 'fromEnd', EDGE_ENDS),
    toNode: takeString(rest, 'toNode') ?? '',
    toSide: takeEnum<NodeSide>(rest, 'toSide', NODE_SIDES),
    toEnd: takeEnum<EdgeEnd>(rest, 'toEnd', EDGE_ENDS),
    color: takeString(rest, 'color'),
    label: takeString(rest, 'label'),
    extra: leftovers(rest),
  };
}

export function parseCanvas(text: string): ParseResult {
  // A file `touch`ed into existence, or one created a moment before its seed
  // landed. An empty board, not an error.
  if (text.trim() === '') {
    return {
      status: 'empty',
      doc: { nodes: [], edges: [], extra: {} },
      indent: DEFAULT_INDENT,
    };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    return {
      status: 'invalid',
      message: error instanceof Error ? error.message : String(error),
      raw: text,
    };
  }

  if (!isPlainObject(raw)) {
    return {
      status: 'invalid',
      message: 'A canvas must be a JSON object.',
      raw: text,
    };
  }

  const rest = { ...raw };
  const rawNodes = take(rest, 'nodes');
  const rawEdges = take(rest, 'edges');

  // Neither renderable nor safe to carry through, so refuse the file rather
  // than let the editor write over it.
  if (rawNodes !== undefined && !Array.isArray(rawNodes)) {
    return { status: 'invalid', message: '"nodes" is not an array.', raw: text };
  }
  if (rawEdges !== undefined && !Array.isArray(rawEdges)) {
    return { status: 'invalid', message: '"edges" is not an array.', raw: text };
  }

  const nodes = (rawNodes ?? [])
    .map((node: unknown, index: number) => parseNode(node, index))
    .filter((node): node is CanvasNode => node !== null);

  const edges = (rawEdges ?? [])
    .map((edge: unknown, index: number) => parseEdge(edge, index))
    .filter((edge): edge is CanvasEdge => edge !== null);

  return {
    status: 'ok',
    doc: { nodes, edges, extra: rest },
    indent: detectIndent(text),
  };
}
