import type { MarkType, Node as PMNode } from '@milkdown/kit/prose/model';

import { MATH_INLINE_SOURCE } from './target';

export type MathMatch = {
  /** Position of the opening `$`. */
  from: number;
  /** Position after the closing `$`. */
  to: number;
  /** The formula, without its delimiters. */
  value: string;
};

/**
 * Inline math is only formed from unformatted text, for the same reason
 * wikilinks are: the mark excludes every other mark, so applying it over
 * emphasised or code text would silently strip that formatting.
 */
function acceptsMath(
  node: PMNode,
  parent: PMNode | null,
  markType: MarkType,
): boolean {
  if (!parent?.type.allowsMarkType(markType)) return false;
  return node.marks.every((mark) => mark.type === markType);
}

/** Every well-formed inline formula in the document, in document order. */
export function findInlineMath(doc: PMNode, markType: MarkType): MathMatch[] {
  const matches: MathMatch[] = [];

  doc.descendants((node, pos, parent) => {
    if (node.type.spec.code) return false;
    if (!node.isText || !node.text) return;
    if (!acceptsMath(node, parent, markType)) return;

    const pattern = new RegExp(MATH_INLINE_SOURCE, 'g');
    let match: RegExpExecArray | null;

    while ((match = pattern.exec(node.text))) {
      matches.push({
        from: pos + match.index,
        to: pos + match.index + match[0].length,
        value: match[1],
      });
    }
  });

  return matches;
}
