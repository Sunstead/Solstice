/**
 * `%%comments%%`, Obsidian's: kept in the file as written, muted in the
 * editor, and left out of read-only views (canvas cards, embeds).
 *
 * They stay plain text in the document, which already round-trips them, so
 * this is decoration only. Inline ones pair within a block; a `%%` left open
 * runs on through the blocks after it to the next `%%`, which is how a comment
 * spans paragraphs.
 */
import type { Node as PMNode } from '@milkdown/kit/prose/model';
import { Plugin, PluginKey } from '@milkdown/kit/prose/state';
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view';
import { $prose } from '@milkdown/kit/utils';

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

function decorate(doc: PMNode): DecorationSet {
  const decorations: Decoration[] = [];
  // Where an unclosed comment began, carried across blocks.
  let openAt: number | null = null;

  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    if (node.type.spec.code) {
      if (openAt !== null) decorations.push(Decoration.node(pos, pos + node.nodeSize, { class: 'solstice-comment-block' }));
      return false;
    }
    const text = textOf(node);
    const start = pos + 1;
    let from = openAt === null ? null : start;
    let at = 0;
    for (;;) {
      const found = text.indexOf(MARKER, at);
      if (found === -1) break;
      if (from === null) {
        from = start + found;
      } else {
        decorations.push(Decoration.inline(from, start + found + MARKER.length, { class: 'solstice-comment' }));
        from = null;
      }
      at = found + MARKER.length;
    }
    if (from !== null) {
      // Open at the end of the block: this one's rest is comment, and so are
      // the blocks after it until a `%%`.
      if (from < start + text.length) decorations.push(Decoration.inline(from, start + text.length, { class: 'solstice-comment' }));
      openAt = from;
    } else {
      openAt = null;
    }
    return false;
  });

  return DecorationSet.create(doc, decorations);
}

const commentKey = new PluginKey<DecorationSet>('comment');

export const commentDecorations = $prose(
  () =>
    new Plugin<DecorationSet>({
      key: commentKey,
      state: {
        init: (_, state) => decorate(state.doc),
        apply: (tr, set) => (tr.docChanged ? decorate(tr.doc) : set),
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
