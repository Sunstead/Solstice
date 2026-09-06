import { DEFAULT_INDENT } from './parse';
import type { CanvasDoc, CanvasEdge, CanvasNode } from './types';

/**
 * Writing a `.canvas` file. Keys go out in the spec's order, then anything
 * preserved.
 *
 * That determinism is what makes `serializeCanvas(parseCanvas(t).doc) === t`
 * hold for a file this app wrote, which lets the autosaver's `getLastWritten`
 * comparison and the external-change check stay plain string equality. It also
 * keeps a board's diff to the lines that changed.
 *
 * `JSON.stringify` drops `undefined` values, so an optional field the document
 * does not carry simply never appears.
 */

function serializeNode(node: CanvasNode): Record<string, unknown> {
  const base = {
    id: node.id,
    // An unrecognised card writes back the `type` it arrived with; when that
    // was absent, `unknownType` is empty and `extra` carries it instead.
    type: node.type === 'unknown' ? node.unknownType || undefined : node.type,
    // The spec stores positions and sizes as integers.
    x: Math.round(node.x),
    y: Math.round(node.y),
    width: Math.round(node.width),
    height: Math.round(node.height),
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

  // Trailing newline, for a text file under version control.
  return `${JSON.stringify(value, null, indent)}\n`;
}
