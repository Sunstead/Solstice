import { embedKind } from '@/lib/embed/kind';
import type { CanvasNode } from './types';

/**
 * Whether a card can be typed into: a text card, or a file card pointing at a
 * note. The extension is read off the stored path rather than resolved against
 * the workspace, since callers have a node and no workspace root to hand.
 */
export function isEditableCard(node: CanvasNode): boolean {
  if (node.type === 'text') return true;
  return node.type === 'file' && embedKind(node.file) === 'markdown';
}
