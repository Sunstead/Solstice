import type { MilkdownPlugin } from '@milkdown/kit/ctx';
import { keymap } from '@milkdown/kit/prose/keymap';
import { TextSelection } from '@milkdown/kit/prose/state';
import { $prose } from '@milkdown/kit/utils';

const CODE_BLOCK = 'code_block';

/**
 * Backspace at the start of the block after a code block removes it outright.
 *
 * The default chain reaches a code block through `joinTextblockBackward`,
 * which merges into it rather than removing it, so clearing one from outside
 * took two presses. Registered as a `$prose` keymap, which runs ahead of the
 * base keymap.
 */
const deleteCodeBlockBackward = $prose(() =>
  keymap({
    Backspace: (state, dispatch) => {
      const { selection } = state;
      if (!(selection instanceof TextSelection)) return false;

      const $cursor = selection.$cursor;
      if (!$cursor || $cursor.parentOffset !== 0 || $cursor.depth === 0) {
        return false;
      }

      const index = $cursor.index($cursor.depth - 1);
      if (index === 0) return false;

      const previous = $cursor.node($cursor.depth - 1).child(index - 1);
      if (previous.type.name !== CODE_BLOCK) return false;

      const from = $cursor.before($cursor.depth) - previous.nodeSize;
      dispatch?.(state.tr.delete(from, from + previous.nodeSize));
      return true;
    },
  }),
);

export const codeBlockKeymap: MilkdownPlugin[] = [deleteCodeBlockBackward].flat();
