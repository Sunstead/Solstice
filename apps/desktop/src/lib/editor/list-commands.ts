import type { NodeType, ResolvedPos } from '@milkdown/kit/prose/model';
import type { Command, Transaction } from '@milkdown/kit/prose/state';
import { wrapInList } from '@milkdown/kit/prose/schema-list';

function itemDepth($pos: ResolvedPos, listItem: NodeType): number | null {
  for (let depth = $pos.depth; depth > 0; depth -= 1) {
    if ($pos.node(depth).type === listItem) return depth;
  }
  return null;
}

/**
 * The selected items become tasks (`- [ ]`), or plain items again if the
 * first one already is. Outside a list, the paragraph becomes a one-item
 * task list.
 */
export function toggleTaskList(listItem: NodeType, bulletList: NodeType): Command {
  return (state, dispatch) => {
    const { $from, $to } = state.selection;
    const depth = itemDepth($from, listItem);

    if (depth === null) {
      let wrapped: Transaction | null = null;
      if (!wrapInList(bulletList)(state, (tr) => (wrapped = tr))) return false;
      if (!dispatch || !wrapped) return true;
      const tr: Transaction = wrapped;
      const $at = tr.selection.$from;
      const at = itemDepth($at, listItem);
      if (at !== null) tr.setNodeMarkup($at.before(at), undefined, { ...$at.node(at).attrs, checked: false });
      dispatch(tr);
      return true;
    }

    if (!dispatch) return true;
    const checked = $from.node(depth).attrs.checked == null ? false : null;
    const tr = state.tr;
    state.doc.nodesBetween($from.before(depth), $to.pos, (node, pos) => {
      if (node.type !== listItem) return true;
      // Items at the first one's level only: walk into outer ones, and leave
      // nested lists as they are.
      const level = state.doc.resolve(pos).depth;
      if (level < depth - 1) return true;
      if (level === depth - 1) tr.setNodeMarkup(pos, undefined, { ...node.attrs, checked });
      return false;
    });
    dispatch(tr);
    return true;
  };
}
