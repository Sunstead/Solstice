/**
 * `%%comments%%`, Obsidian's: kept in the file as written, muted in the
 * editor, and left out of read-only views (canvas cards, embeds).
 *
 * They stay plain text in the document, which already round-trips them, so
 * this is decoration only. An inline one's `%%` are hidden unless the
 * selection touches it, as a wikilink's brackets are. Inline ones pair within a block; a `%%` left open
 * runs on through the blocks after it to the next `%%`, which is how a comment
 * spans paragraphs.
 */
import type { Node as PMNode } from '@milkdown/kit/prose/model';
import { Plugin, PluginKey, type EditorState, type Selection } from '@milkdown/kit/prose/state';
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view';
import { $prose } from '@milkdown/kit/utils';

import { touches, type HiddenSource } from '@/lib/editor/hidden-ranges';

const MARKER = '%%';

/**
 * A block's text, one character per position: leaves as a placeholder, and
 * inline code blanked out, since `%%` means nothing there.
 */
function textOf(block: PMNode): string {
  let text = '';
  block.forEach((child) => {
    if (!child.isText) text += '\uFFFC';
    else if (child.marks.some((m) => m.type.name === 'inlineCode')) text += ' '.repeat(child.nodeSize);
    else text += child.text;
  });
  return text;
}

/** Each inline comment's span, `%%` included. */
function inlineComments(doc: PMNode): { from: number; to: number }[] {
  const found: { from: number; to: number }[] = [];
  scan(doc, (from, to, carried) => {
    if (!carried) found.push({ from, to });
  });
  return found;
}

/**
 * Every comment in `doc`: `closed` for each one ending in a block (`carried`
 * when it began in an earlier one), `open` for the rest of a block one runs
 * on past, and `block` for a code block inside one.
 */
function scan(
  doc: PMNode,
  closed: (from: number, to: number, carried: boolean) => void,
  open: (from: number, to: number) => void = () => {},
  block: (from: number, to: number) => void = () => {},
) {
  // Where an unclosed comment began, carried across blocks.
  let openAt: number | null = null;

  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    if (node.type.spec.code) {
      if (openAt !== null) block(pos, pos + node.nodeSize);
      return false;
    }
    const text = textOf(node);
    const start = pos + 1;
    let from = openAt === null ? null : start;
    // Carried on from an earlier block, so its opening `%%` isn't here.
    let carried = openAt !== null;
    let at = 0;
    for (;;) {
      const found = text.indexOf(MARKER, at);
      if (found === -1) break;
      if (from === null) {
        from = start + found;
      } else {
        closed(from, start + found + MARKER.length, carried);
        from = null;
        carried = false;
      }
      at = found + MARKER.length;
    }
    if (from !== null) {
      // Open at the end of the block: this one's rest is comment, and so are
      // the blocks after it until a `%%`.
      if (from < start + text.length) open(from, start + text.length);
      openAt = from;
    } else {
      openAt = null;
    }
    return false;
  });
}

/** An inline comment's `%%`s are hidden while the selection is outside it. */
export function hiddenSource(state: EditorState): HiddenSource[] {
  return inlineComments(state.doc).map(({ from, to }) => ({
    from,
    to,
    hidden: [
      { from, to: from + MARKER.length },
      { from: to - MARKER.length, to },
    ],
    collapsed: !touches(state.selection, from, to),
  }));
}

export function decorate(doc: PMNode, selection?: Pick<Selection, 'from' | 'to'>): DecorationSet {
  const decorations: Decoration[] = [];
  scan(
    doc,
    (from, to, carried) => {
      decorations.push(Decoration.inline(from, to, { class: 'solstice-comment' }));
      if (!carried && selection && !touches(selection, from, to)) {
        decorations.push(Decoration.inline(from, from + MARKER.length, { class: 'solstice-comment-marker' }));
        decorations.push(Decoration.inline(to - MARKER.length, to, { class: 'solstice-comment-marker' }));
      }
    },
    (from, to) => decorations.push(Decoration.inline(from, to, { class: 'solstice-comment' })),
    (from, to) => decorations.push(Decoration.node(from, to, { class: 'solstice-comment-block' })),
  );
  return DecorationSet.create(doc, decorations);
}

const commentKey = new PluginKey<DecorationSet>('comment');

export const commentDecorations = $prose(
  () =>
    new Plugin<DecorationSet>({
      key: commentKey,
      hiddenSource,
      state: {
        init: (_, state) => decorate(state.doc, state.selection),
        apply: (tr, set, _old, state) =>
          tr.docChanged || tr.selectionSet ? decorate(state.doc, state.selection) : set,
      },
      props: {
        decorations: (state) => commentKey.getState(state),
      },
    }),
);

/**
 * Markdown with its comments taken out, for views that only read it. Code
 * (fenced blocks and inline spans) is left alone: `%%` means nothing there.
 */
export function stripComments(markdown: string): string {
  if (!markdown.includes(MARKER)) return markdown;
  let out = '';
  let inComment = false;
  let fence: string | null = null;

  for (const line of markdown.split(/(?<=\n)/)) {
    const fenceMatch = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (fence !== null) {
      if (!inComment) out += line;
      if (fenceMatch && fenceMatch[1][0] === fence[0] && fenceMatch[1].length >= fence.length) fence = null;
      continue;
    }
    if (fenceMatch && !inComment) {
      fence = fenceMatch[1];
      out += line;
      continue;
    }
    // Outside code: walk the line, skipping inline code spans.
    let i = 0;
    while (i < line.length) {
      if (!inComment && line[i] === '`') {
        const ticks = /^`+/.exec(line.slice(i))![0];
        const close = line.indexOf(ticks, i + ticks.length);
        const end = close === -1 ? i + ticks.length : close + ticks.length;
        out += line.slice(i, end);
        i = end;
        continue;
      }
      if (line.startsWith(MARKER, i)) {
        inComment = !inComment;
        i += MARKER.length;
        continue;
      }
      if (!inComment) out += line[i];
      i += 1;
    }
  }
  return out;
}
