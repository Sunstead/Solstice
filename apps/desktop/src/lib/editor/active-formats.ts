import type { CommandId } from '@/bindings';
import type { EditorState } from '@milkdown/kit/prose/state';

const MARKS: [string, CommandId][] = [
  ['strong', 'edit.bold'],
  ['emphasis', 'edit.italic'],
  ['strike_through', 'edit.strikethrough'],
  ['highlight', 'edit.highlight'],
  ['inlineCode', 'edit.inline_code'],
];

/**
 * The Format commands already in effect at the selection, for toolbars to
 * show pressed: its marks (all of the selection must have one), its block,
 * and the kind of list it's in.
 */
export function activeFormats(state: EditorState): Set<CommandId> {
  const active = new Set<CommandId>();
  const { from, to, empty, $from } = state.selection;
  const marks = empty ? (state.storedMarks ?? $from.marks()) : null;

  for (const [name, id] of MARKS) {
    const type = state.schema.marks[name];
    if (!type) continue;
    const on = marks
      ? marks.some((m) => m.type === type)
      : (() => {
          let all = true;
          let any = false;
          state.doc.nodesBetween(from, to, (node) => {
            if (!node.isText) return;
            any = true;
            if (!type.isInSet(node.marks)) all = false;
          });
          return any && all;
        })();
    if (on) active.add(id);
  }

  const block = $from.parent;
  if (block.type.name === 'heading') active.add(`edit.heading${block.attrs.level}` as CommandId);
  if (block.type.name === 'code_block') active.add('edit.code_block');

  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const node = $from.node(depth);
    if (node.type.name === 'blockquote') active.add('edit.blockquote');
    if (node.type.name !== 'list_item') continue;
    const list = $from.node(depth - 1);
    if (list.type.name === 'ordered_list') active.add('edit.ordered_list');
    else active.add(node.attrs.checked == null ? 'edit.bullet_list' : 'edit.task_list');
    // The innermost list only.
    break;
  }
  return active;
}
