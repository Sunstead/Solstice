import { embedKind } from '@/lib/embed/kind';
import type { CanvasNode } from './types';

/**
 * Whether a card can be typed into.
 *
 * Two kinds can. A text card holds its markdown in the `.canvas` file itself; a
 * file card pointing at a note edits that note on disk. Everything else -- a
 * link, an image, a group -- has nothing to put a caret in.
 *
 * The extension is read straight off the stored path rather than resolving it
 * against the workspace first: `embedKind` only looks at the extension, and the
 * callers that need this (a double-click, an Enter press) have a node and no
 * workspace root to hand.
 */
export function isEditableCard(node: CanvasNode): boolean {
  if (node.type === 'text') return true;
  return node.type === 'file' && embedKind(node.file) === 'markdown';
}
