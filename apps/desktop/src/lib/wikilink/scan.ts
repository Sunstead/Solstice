import type { MarkType, Node as PMNode } from '@milkdown/kit/prose/model';
import type { EditorState } from '@milkdown/kit/prose/state';

import { WIKILINK_SOURCE } from './target';

export type WikilinkMatch = {
  /** Position of the opening `[`. */
  from: number;
  /** Position after the closing `]`. */
  to: number;
  /** Raw text between the brackets, exactly as written. */
  target: string;
};

/** Placeholder character standing in for inline leaf nodes while scanning. */
const LEAF = '\ufffc';

/**
 * A wikilink is only formed from unformatted text: the mark excludes every
 * other mark, so applying it over emphasised or code text would silently strip
 * that formatting.
 */
function acceptsWikilink(
  node: PMNode,
  parent: PMNode | null,
  markType: MarkType,
): boolean {
  if (!parent?.type.allowsMarkType(markType)) return false;
  return node.marks.every((mark) => mark.type === markType);
}

/**
 * Every well-formed wikilink in the document, in document order. This is the
 * single source of truth for both the mark sync and the decorations, so the
 * two can never disagree about where a link starts and ends.
 */
export function findWikilinks(
  doc: PMNode,
  markType: MarkType,
): WikilinkMatch[] {
  const matches: WikilinkMatch[] = [];

  doc.descendants((node, pos, parent) => {
    if (!node.isText || !node.text) return;
    if (!acceptsWikilink(node, parent, markType)) return;

    const pattern = new RegExp(WIKILINK_SOURCE, 'g');
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(node.text))) {
      matches.push({
        from: pos + match.index,
        to: pos + match.index + match[0].length,
        target: match[1],
      });
    }
  });

  return matches;
}

export function wikilinkAt(
  state: EditorState,
  markType: MarkType,
  pos: number,
): WikilinkMatch | undefined {
  return findWikilinks(state.doc, markType).find(
    (match) => pos >= match.from && pos <= match.to,
  );
}

/**
 * The half-written link the cursor sits in, if any: everything after the last
 * unclosed `[[` in the current block. Drives closing-bracket skipping today,
 * and is the query an autocomplete popup will read.
 */
export function activeWikilinkQuery(state: EditorState) {
  const { $from, empty } = state.selection;
  if (!empty || !$from.parent.isTextblock) return null;

  const before = $from.parent.textBetween(0, $from.parentOffset, undefined, LEAF);
  const open = before.lastIndexOf('[[');
  if (open === -1) return null;

  const query = before.slice(open + 2);
  if (/[[\]\n]/.test(query) || query.includes(LEAF)) return null;

  return { from: $from.start() + open, to: $from.pos, query };
}