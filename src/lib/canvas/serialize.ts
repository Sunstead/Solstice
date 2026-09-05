import { DEFAULT_INDENT } from './parse';
import type { CanvasDoc, CanvasEdge, CanvasNode } from './types';

/**
 * Writing a `.canvas` file.
 *
 * Keys go out in the order the spec lists them, then anything preserved. That
 * determinism is not cosmetic: it is what makes
 * `serializeCanvas(parseCanvas(text).doc) === text` hold for a file this app
 * wrote, which in turn lets the autosaver's `getLastWritten()` comparison and
 * the external-change check stay plain string equality with no normalization
 * layer in between. It also keeps a board's diff to the lines that changed.
 *
 * `JSON.stringify` drops keys whose value is `undefined`, so an optional field
 * the document does not carry simply never appears -- there is no need to build
 * the object conditionally.
 */

/** The spec stores positions and sizes as integers. */
const round = (value: number) => Math.round(value);

function serializeNode(node: CanvasNode): Record<string, unknown> {
  const base = {
    id: node.id,
    // An unrecognised card writes back the `type` string it arrived with. When
    // that was absent or not a string, `unknownType` is empty and the original
    // value -- if there was one -- comes back out of `extra` below instead.
    type: node.type === 'unknown' ? node.unknownType || undefined : node.type,
    x: round(node.x),
    y: round(node.y),
    width: round(node.width),
    height: round(node.height),
    color: node.color,
  };

  switch (node.type) {
    case 'text':
      return { ...base, text: node.text, ...node.extra };
    case 'file':
      return { ...base, file: node.file, subpath: node.subpath, ...node.extra };
    case 'link':
      return { ...base, url: node.url, ...node.extra };
    case 'group':
      return {
        ...base,
        label: node.label,
        background: node.background,
        backgroundStyle: node.backgroundStyle,
        ...node.extra,
      };
    default:
      return { ...base, ...node.extra };
  }
}

function serializeEdge(edge: CanvasEdge): Record<string, unknown> {
  return {
    id: edge.id,
    fromNode: edge.fromNode,
    fromSide: edge.fromSide,
    fromEnd: edge.fromEnd,
    toNode: edge.toNode,
    toSide: edge.toSide,
    toEnd: edge.toEnd,
    color: edge.color,
    label: edge.label,
    ...edge.extra,
  };
}

/**
 * @param indent Whatever `parseCanvas` found in the file, so a board authored
 *   elsewhere keeps its own style instead of being restyled on first save.
 */
export function serializeCanvas(
  doc: CanvasDoc,
  indent: string = DEFAULT_INDENT,
): string {
  const value = {
    nodes: doc.nodes.map(serializeNode),
    edges: doc.edges.map(serializeEdge),
    ...doc.extra,
  };

  // The trailing newline is table stakes for a text file under version control.
  return `${JSON.stringify(value, null, indent)}\n`;
}
