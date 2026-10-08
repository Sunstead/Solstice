/**
 * Block ids, Obsidian's `^id` at the end of a block, which `[[note#^id]]`
 * links to and `![[note#^id]]` embeds. They stay plain text in the note; the
 * editor shows them quietly.
 */
import type { Node as PMNode } from '@milkdown/kit/prose/model';
import { Plugin, PluginKey } from '@milkdown/kit/prose/state';
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view';
import { $prose } from '@milkdown/kit/utils';

const BLOCK_ID = /(?:^|\s)(\^[A-Za-z0-9-]+)\s*$/;

/** A block's id, without its `^`. */
export function blockIdOf(block: PMNode): string | null {
  return BLOCK_ID.exec(block.textContent)?.[1].slice(1) ?? null;
}

/** Six letters and digits, as Obsidian makes them. */
export function newBlockId(): string {
  return Math.random().toString(36).slice(2, 8).padEnd(6, '0');
}

/** Where a heading (by its text) or a block (by its id) starts, if the note has it. */
export function findAnchor(doc: PMNode, anchor: { heading: string | null; block: string | null }): number | null {
  const wanted = anchor.heading?.trim().toLowerCase();
  let found: number | null = null;
  doc.descendants((node, pos) => {
    if (found !== null) return false;
    if (!node.isTextblock) return true;
    if (wanted && node.type.name === 'heading' && node.textContent.trim().toLowerCase() === wanted) found = pos;
    if (anchor.block && blockIdOf(node) === anchor.block) found = pos;
    return false;
  });
  return found;
}

function decorate(doc: PMNode): DecorationSet {
  const decorations: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    if (node.type.spec.code || !node.lastChild?.isText) return false;
    const text = node.lastChild.text ?? '';
    const match = BLOCK_ID.exec(text);
    if (match) {
      const end = pos + node.nodeSize - 1;
      const from = end - (text.length - text.indexOf(match[1], match.index));
      decorations.push(Decoration.inline(from, end, { class: 'solstice-block-id' }));
    }
    return false;
  });
  return DecorationSet.create(doc, decorations);
}

const key = new PluginKey<DecorationSet>('block-id');

export const blockIdDecorations = $prose(
  () =>
    new Plugin<DecorationSet>({
      key,
      state: {
        init: (_, state) => decorate(state.doc),
        apply: (tr, set) => (tr.docChanged ? decorate(tr.doc) : set),
      },
      props: { decorations: (state) => key.getState(state) },
    }),
);
