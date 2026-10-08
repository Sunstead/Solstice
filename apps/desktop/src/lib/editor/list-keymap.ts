import type { MilkdownPlugin } from '@milkdown/kit/ctx';
import { InputRule } from '@milkdown/kit/prose/inputrules';
import { keymap } from '@milkdown/kit/prose/keymap';
import { findWrapping } from '@milkdown/kit/prose/transform';
import { bulletListSchema, listItemSchema, paragraphSchema } from '@milkdown/kit/preset/commonmark';
import { $inputRule, $prose } from '@milkdown/kit/utils';

import { listBackspace, listEnter } from './list-commands';

/**
 * Enter and Backspace in lists (`listEnter`, `listBackspace`). A `$prose`
 * keymap, so it runs ahead of the preset's list item keymap and falls through
 * to it when it doesn't apply.
 */
const listKeys = $prose((ctx) => {
  const listItem = listItemSchema.type(ctx);
  return keymap({ Enter: listEnter(listItem), Backspace: listBackspace(listItem) });
});

/**
 * `[ ] ` or `[x] ` at the start of a paragraph makes a task. The gfm preset's
 * rule only turns an existing item into one, so `- ` had to come first.
 */
const taskFromParagraph = $inputRule(
  (ctx) =>
    new InputRule(/^\[([ xX])\]\s$/, (state, match, start, end) => {
      const listItem = listItemSchema.type(ctx);
      const $start = state.doc.resolve(start);
      if ($start.parent.type !== paragraphSchema.type(ctx)) return null;
      for (let depth = $start.depth; depth > 0; depth -= 1) {
        if ($start.node(depth).type === listItem) return null;
      }

      const tr = state.tr.delete(start, end);
      const range = tr.doc.resolve(start).blockRange();
      const wrapping = range && findWrapping(range, bulletListSchema.type(ctx));
      if (!range || !wrapping) return null;
      tr.wrap(range, wrapping);
      const itemPos = range.start + 1;
      const item = tr.doc.nodeAt(itemPos);
      if (item?.type !== listItem) return null;
      return tr.setNodeMarkup(itemPos, undefined, { ...item.attrs, checked: match[1] !== ' ' });
    }),
);

export const listEditing: MilkdownPlugin[] = [listKeys, taskFromParagraph].flat();
