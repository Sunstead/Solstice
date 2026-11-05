import type { Node as PMNode } from '@milkdown/kit/prose/model';
import { Selection, type TextSelection } from '@milkdown/kit/prose/state';

/**
 * The nearest text caret to `pos`, or null. Not `TextSelection.near`, which
 * despite the name can return a selected block (front matter, say), and
 * whatever's inserted next would then replace it.
 */
export function textCaretNear(doc: PMNode, pos: number): TextSelection | null {
  const $pos = doc.resolve(pos);
  return (Selection.findFrom($pos, 1, true) ?? Selection.findFrom($pos, -1, true)) as TextSelection | null;
}
