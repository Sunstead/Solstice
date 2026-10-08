import type { MilkdownPlugin } from '@milkdown/kit/ctx';
import { chainCommands, deleteSelection, joinTextblockBackward, selectNodeBackward } from '@milkdown/kit/prose/commands';
import { InputRule, undoInputRule } from '@milkdown/kit/prose/inputrules';
import { findWrapping } from '@milkdown/kit/prose/transform';
import { bulletListSchema, listItemSchema, paragraphSchema } from '@milkdown/kit/preset/commonmark';
import { keymap } from '@milkdown/kit/prose/keymap';
import { Plugin } from '@milkdown/kit/prose/state';
import { $inputRule, $prose } from '@milkdown/kit/utils';

import { listBackspace, listEnter } from './list-commands';

/**
 * Enter and Backspace in lists (`listEnter`, `listBackspace`). A `$prose`
 * keymap: those run before Milkdown's assembled one, so these go first and
 * fall through to the preset's list keys when they don't apply. (Not
 * `$shortcut`: the editor doesn't wait for one, so it can miss the keymap.)
 */
const listKeys = $prose((ctx) => {
  const listItem = listItemSchema.type(ctx);
  const backspace = listBackspace(listItem);
  return keymap({
    Enter: listEnter(listItem),
    Backspace: backspace,
    // iOS shifts at the start of a line, so its Backspace there is
    // Shift-Backspace, which ProseMirror's base keymap answers with
    // `joinBackward`, not Milkdown's Backspace (it nests the line in the list
    // above). Both get the same.
    'Shift-Backspace': chainCommands(backspace, undoInputRule, deleteSelection, joinTextblockBackward, selectNodeBackward),
  });
});

/**
 * The same Backspace from an on-screen keyboard. iOS often sends no keydown
 * for it (predictive text holds a composition open), and WebKit's own merge
 * of the item into the one above is what ProseMirror then reads back: a
 * bullet-less paragraph inside it. `beforeinput` comes first, and cancels.
 */
const listBackspaceInput = $prose(
  (ctx) =>
    new Plugin({
      props: {
        handleDOMEvents: {
          beforeinput: (view, event) => {
            if ((event as InputEvent).inputType !== 'deleteContentBackward') return false;
            if (!listBackspace(listItemSchema.type(ctx))(view.state, view.dispatch)) return false;
            event.preventDefault();
            return true;
          },
        },
      },
    }),
);

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

export const listEditing: MilkdownPlugin[] = [listKeys, listBackspaceInput, taskFromParagraph].flat();
