import type { Attrs, Node as PMNode, NodeType, ResolvedPos } from '@milkdown/kit/prose/model';
import { Selection, type Command, type EditorState, type Transaction } from '@milkdown/kit/prose/state';
import { liftListItem, splitListItem, wrapInList } from '@milkdown/kit/prose/schema-list';

/** The node types the list commands work with, from the editor's schema. */
export interface ListTypes {
  listItem: NodeType;
  bulletList: NodeType;
  orderedList: NodeType;
}

/** A task list is a bullet list whose items carry `checked`. */
export type ListKind = 'bullet' | 'ordered' | 'task';

function itemDepth($pos: ResolvedPos, listItem: NodeType): number | null {
  for (let depth = $pos.depth; depth > 0; depth -= 1) {
    if ($pos.node(depth).type === listItem) return depth;
  }
  return null;
}

/** What `item` reads as: its list's type, or a task when it's checkable. */
function kindOf(list: PMNode, item: PMNode, types: ListTypes): ListKind {
  if (list.type === types.orderedList) return 'ordered';
  return item.attrs.checked == null ? 'bullet' : 'task';
}

/**
 * Runs `command` until it stops applying (at most `limit` times), as one
 * transaction: lifting a nested item out of every list is one lift per level.
 */
function repeat(state: EditorState, command: Command, limit = 8): Transaction | null {
  const tr = state.tr;
  let current = state;
  for (let i = 0; i < limit; i += 1) {
    let next: Transaction | null = null;
    if (!command(current, (t) => (next = t))) break;
    const applied: Transaction = next!;
    for (const step of applied.steps) tr.step(step);
    current = current.apply(applied);
  }
  if (!tr.docChanged) return null;
  return tr.setSelection(Selection.fromJSON(tr.doc, current.selection.toJSON()));
}

/** Items directly in the list at `listPos`, with their positions. */
function itemsOf(doc: PMNode, listPos: number): { node: PMNode; pos: number }[] {
  const list = doc.nodeAt(listPos)!;
  const items: { node: PMNode; pos: number }[] = [];
  list.forEach((node, offset) => items.push({ node, pos: listPos + 1 + offset }));
  return items;
}

function itemAttrs(item: PMNode, kind: ListKind, index: number): Attrs {
  return {
    ...item.attrs,
    listType: kind === 'ordered' ? 'ordered' : 'bullet',
    label: kind === 'ordered' ? `${index + 1}.` : '•',
    checked: kind === 'task' ? (item.attrs.checked ?? false) : null,
  };
}

/**
 * The bullet, numbered and task buttons, as toggles: in a list of that kind,
 * the selected items become paragraphs again; in another kind, they take this
 * kind (a whole list, between numbered and not); outside a list, each
 * selected paragraph becomes an item.
 */
export function toggleList(kind: ListKind, types: ListTypes): Command {
  return (state, dispatch) => {
    const { $from } = state.selection;
    const depth = itemDepth($from, types.listItem);

    if (depth === null) {
      const listType = kind === 'ordered' ? types.orderedList : types.bulletList;
      let wrapped: Transaction | null = null;
      if (!wrapInList(listType)(state, (tr) => (wrapped = tr))) return false;
      if (!dispatch) return true;
      const tr: Transaction = wrapped!;
      if (kind === 'task') {
        const from = tr.mapping.map(state.selection.from, -1);
        const to = tr.mapping.map(state.selection.to);
        tr.doc.nodesBetween(from, to, (node, pos) => {
          if (node.type !== types.listItem) return true;
          tr.setNodeMarkup(pos, undefined, { ...node.attrs, checked: false });
          return false;
        });
      }
      dispatch(tr);
      return true;
    }

    const item = $from.node(depth);
    const list = $from.node(depth - 1);
    const current = kindOf(list, item, types);

    if (current === kind) {
      const tr = repeat(state, liftListItem(types.listItem));
      if (!tr) return false;
      dispatch?.(tr);
      return true;
    }

    if (!dispatch) return true;
    const tr = state.tr;

    // Tasks and bullets share a list type, so switching between them is per
    // item: the selected ones at the first one's level.
    if (list.type === types.bulletList && kind !== 'ordered') {
      const checked = kind === 'task' ? false : null;
      state.doc.nodesBetween($from.before(depth), state.selection.to, (node, pos) => {
        if (node.type !== types.listItem) return true;
        const level = state.doc.resolve(pos).depth;
        if (level < depth - 1) return true;
        if (level === depth - 1) tr.setNodeMarkup(pos, undefined, { ...node.attrs, checked });
        return false;
      });
      dispatch(tr);
      return true;
    }

    const listPos = $from.before(depth - 1);
    const listType = kind === 'ordered' ? types.orderedList : types.bulletList;
    if (list.type !== listType) {
      const attrs = kind === 'ordered' ? { order: 1, spread: list.attrs.spread } : { spread: list.attrs.spread };
      tr.setNodeMarkup(listPos, listType, attrs);
    }
    itemsOf(tr.doc, listPos).forEach(({ node, pos }, index) => {
      tr.setNodeMarkup(pos, undefined, itemAttrs(node, kind, index));
    });
    dispatch(tr);
    return true;
  };
}

/** Whether the caret is at the very start of a list item's first paragraph. */
function caretAtItemStart(state: EditorState, listItem: NodeType): boolean {
  const { $from, empty } = state.selection;
  if (!empty || $from.depth < 2 || $from.parentOffset !== 0) return false;
  const depth = $from.depth - 1;
  return $from.node(depth).type === listItem && $from.index(depth) === 0;
}

/** Whether the item at `depth` sits in a list that's itself in an item. */
function isNested($pos: ResolvedPos, depth: number, listItem: NodeType): boolean {
  return depth >= 3 && $pos.node(depth - 2).type === listItem;
}

/**
 * Enter in a list, as notes apps do it: an empty nested item steps out a
 * level (still a task, if it was one), and a task's new item starts
 * unchecked. Everything else is the preset's.
 */
export function listEnter(listItem: NodeType): Command {
  return (state, dispatch) => {
    const { $from, empty } = state.selection;
    if (!empty || $from.depth < 2) return false;
    const depth = $from.depth - 1;
    const item = $from.node(depth);
    if (item.type !== listItem) return false;

    const blank = $from.parent.content.size === 0 && item.childCount === 1;
    if (blank) {
      if (!isNested($from, depth, listItem)) return false;
      return liftListItem(listItem)(state, dispatch);
    }

    if (item.attrs.checked == null) return false;
    return splitListItem(listItem, { ...item.attrs, checked: false })(state, dispatch);
  };
}

/**
 * Backspace at the start of an item takes it out a level: a nested item
 * outdents, and a top-level one becomes a paragraph. The next Backspace
 * then joins it to what's above, as in any paragraph.
 */
export function listBackspace(listItem: NodeType): Command {
  return (state, dispatch) => {
    if (!caretAtItemStart(state, listItem)) return false;
    return liftListItem(listItem)(state, dispatch);
  };
}
