/**
 * Backspace and Delete, one chain each, whether a key or the system brings
 * them: lists (R4), hidden source (R3), then blocks (R5). What none of them
 * takes goes on to the preset's keys, or the browser.
 *
 * iOS's on-screen keyboard often sends no keydown (predictive text holds a
 * composition open), only `beforeinput`, and WebKit's own deletion is what
 * ProseMirror would then read back (an item merged into the one above as a
 * bullet-less paragraph inside it). So `beforeinput` runs the same chain and
 * cancels when it applies.
 */
import { chainCommands, deleteSelection, joinTextblockBackward, selectNodeBackward } from '@milkdown/kit/prose/commands';
import { undoInputRule } from '@milkdown/kit/prose/inputrules';
import { keymap } from '@milkdown/kit/prose/keymap';
import { Plugin, PluginKey, type Command } from '@milkdown/kit/prose/state';
import { listItemSchema } from '@milkdown/kit/preset/commonmark';
import { $prose } from '@milkdown/kit/utils';

import { blockEdgeDelete } from './block-edges';
import { deleteInSource } from './hidden-ranges';
import { listBackspace, listDelete } from './list-commands';

export const deleteKeys = $prose((ctx) => {
  const listItem = listItemSchema.type(ctx);
  const backward: Command = chainCommands(listBackspace(listItem), deleteInSource(-1), blockEdgeDelete(-1));
  const forward: Command = chainCommands(listDelete(listItem), deleteInSource(1), blockEdgeDelete(1));
  const keys = keymap({
    Backspace: backward,
    // iOS shifts at the start of a line, so its Backspace there is
    // Shift-Backspace, which ProseMirror's base keymap answers with
    // `joinBackward`, not Milkdown's Backspace (it nests the line in the list
    // above). Both get the same.
    'Shift-Backspace': chainCommands(backward, undoInputRule, deleteSelection, joinTextblockBackward, selectNodeBackward),
    Delete: forward,
  });

  return new Plugin({
    key: new PluginKey('delete-keys'),
    props: {
      handleKeyDown: keys.props.handleKeyDown,
      handleDOMEvents: {
        beforeinput: (view, event) => {
          const type = (event as InputEvent).inputType;
          const command = type === 'deleteContentBackward' ? backward : type === 'deleteContentForward' ? forward : null;
          if (!command || view.composing) return false;
          if (!command(view.state, view.dispatch)) return false;
          event.preventDefault();
          return true;
        },
      },
    },
  });
});
