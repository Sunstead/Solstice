import { InputRule } from '@milkdown/kit/prose/inputrules';
import { $inputRule, $nodeSchema } from '@milkdown/kit/utils';

import { WIKI_EMBED_MDAST_TYPE } from '@/lib/wikilink/syntax';
import { EMBED_SOURCE } from '@/lib/wikilink/target';

export const WIKI_EMBED_NODE = 'wiki_embed';

const EMBED_ATTRIBUTE = 'data-wiki-embed';

/**
 * `![[target]]`, as an atom node.
 *
 * Unlike a wikilink -- which stays literal text under a mark so it can be
 * edited as text -- an embed renders someone else's content, and there is no
 * useful way to put a foreign document inside a text run. The whole raw target
 * is kept in a single `value` attribute rather than split into path/heading/
 * size attributes, which makes the round trip exact by construction: whatever
 * was between the brackets is written back between the brackets.
 */
export const wikiEmbedSchema = $nodeSchema(WIKI_EMBED_NODE, () => ({
  inline: true,
  group: 'inline',
  atom: true,
  selectable: true,
  draggable: true,
  marks: '',
  defining: true,
  isolating: true,
  attrs: {
    value: { default: '', validate: 'string' },
  },
  parseDOM: [
    {
      tag: `span[${EMBED_ATTRIBUTE}]`,
      getAttrs: (dom: HTMLElement | string) => ({
        value: (dom as HTMLElement).getAttribute(EMBED_ATTRIBUTE) || '',
      }),
    },
  ],
  toDOM: (node) => ['span', { [EMBED_ATTRIBUTE]: node.attrs.value }],
  parseMarkdown: {
    match: ({ type }) => type === WIKI_EMBED_MDAST_TYPE,
    runner: (state, node, type) => {
      state.addNode(type, { value: String(node.value ?? '') });
    },
  },
  toMarkdown: {
    match: (node) => node.type.name === WIKI_EMBED_NODE,
    runner: (state, node) => {
      state.addNode(WIKI_EMBED_MDAST_TYPE, undefined, undefined, {
        value: node.attrs.value,
      });
    },
  },
}));

/**
 * Turns `![[target]]` into an embed as it is typed. Without it the text would
 * stay text until the file was reparsed, which is the same gap the commonmark
 * preset leaves for images.
 */
export const insertWikiEmbedInputRule = $inputRule(
  (ctx) =>
    new InputRule(new RegExp(`${EMBED_SOURCE}$`), (state, match, start, end) =>
      state.tr.replaceWith(
        start,
        end,
        wikiEmbedSchema.type(ctx).create({ value: match[1] }),
      ),
    ),
);
