import type { Ctx, MilkdownPlugin } from '@milkdown/kit/ctx';
import { InputRule } from '@milkdown/kit/prose/inputrules';
import { findWrapping } from '@milkdown/kit/prose/transform';
import {
  bulletListKeymap,
  bulletListSchema,
  listItemKeymap,
  listItemSchema,
  orderedListKeymap,
  paragraphSchema,
} from '@milkdown/kit/preset/commonmark';
import { keymap } from '@milkdown/kit/prose/keymap';
import { $inputRule, $prose } from '@milkdown/kit/utils';

import { listEnter } from './list-commands';

/**
 * Enter in lists (`listEnter`). A `$prose` keymap: those run before
 * Milkdown's assembled one, so this goes first and falls through to the
 * preset's list keys when it doesn't apply. (Not `$shortcut`: the editor
 * doesn't wait for one, so it can miss the keymap.) Backspace and Delete are
 * `delete-keys.ts`'s.
 */
const listKeys = $prose((ctx) => keymap({ Enter: listEnter(listItemSchema.type(ctx)) }));

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

/** The preset's list keys as the note editor has them. Call in `.config`. */
export function configureListKeys(ctx: Ctx) {
  // Mod-] and Mod-[ are `edit.indent`/`edit.outdent` now; Tab stays.
  ctx.update(listItemKeymap.key, (keys) => ({
    ...keys,
    SinkListItem: { ...keys.SinkListItem, shortcuts: ['Tab'] },
    LiftListItem: { ...keys.LiftListItem, shortcuts: ['Shift-Tab'] },
  }));
  // The list toggles (`toggleList`) are app commands, with app keys.
  ctx.update(bulletListKeymap.key, (keys) => ({ ...keys, WrapInBulletList: { shortcuts: [] } }));
  ctx.update(orderedListKeymap.key, (keys) => ({ ...keys, WrapInOrderedList: { shortcuts: [] } }));
}
