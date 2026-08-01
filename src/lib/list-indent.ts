import { EditorState, ChangeSpec, StateCommand } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';
import type { KeyBinding } from '@codemirror/view';

// Two spaces == the content column of a "- " bullet, which is what the
// GFM list parser actually checks a following line's indentation
// against to decide whether it nests under the previous item as a
// sub-list. Since list-markers.ts normalizes every bullet in the
// document to "-", two spaces is the correct, parser-matching indent
// step for every bullet list here. (Ordered lists with wider markers,
// e.g. "10. ", aren't special-cased -- two spaces is still enough
// indentation to nest under them, just not pixel-matched to their
// marker width.)
const LIST_INDENT_UNIT = '  ';

function linesTouchedBySelection(state: EditorState): number[] {
  const lines = new Set<number>();
  for (const range of state.selection.ranges) {
    const from = state.doc.lineAt(range.from).number;
    const to = state.doc.lineAt(range.to).number;
    for (let n = from; n <= to; n++) lines.add(n);
  }
  return [...lines].sort((a, b) => a - b);
}

// True if `line` is part of a list item. Resolved from a position near
// the END of the line (rather than the start) so this also matches
// wrapped continuation lines of a list item's own content, not just
// lines that literally begin with a marker.
function isListLine(
  state: EditorState,
  line: { from: number; to: number; length: number },
): boolean {
  if (line.length === 0) return false;

  const pos = Math.max(line.from, line.to - 1);
  let node: import('@lezer/common').SyntaxNode | null = syntaxTree(state).resolveInner(pos, 1);
  while (node) {
    if (node.name === 'ListItem') return true;
    node = node.parent;
  }
  return false;
}

export const indentListLines: StateCommand = ({ state, dispatch }) => {
  const touched = linesTouchedBySelection(state).filter((n) =>
    isListLine(state, state.doc.line(n)),
  );
  if (!touched.length) return false;

  const changes: ChangeSpec[] = touched.map((n) => ({
    from: state.doc.line(n).from,
    insert: LIST_INDENT_UNIT,
  }));
  dispatch(state.update({ changes, scrollIntoView: true, userEvent: 'input.indent' }));
  return true;
};

export const outdentListLines: StateCommand = ({ state, dispatch }) => {
  const touched = linesTouchedBySelection(state).filter((n) =>
    isListLine(state, state.doc.line(n)),
  );
  if (!touched.length) return false;

  const changes: ChangeSpec[] = [];
  for (const n of touched) {
    const line = state.doc.line(n);
    if (line.text.startsWith('\t')) {
      changes.push({ from: line.from, to: line.from + 1 });
      continue;
    }
    const leading = /^ */.exec(line.text)![0].length;
    const strip = Math.min(leading, LIST_INDENT_UNIT.length);
    if (strip > 0) changes.push({ from: line.from, to: line.from + strip });
  }
  if (!changes.length) return false;

  dispatch(state.update({ changes, scrollIntoView: true, userEvent: 'delete.dedent' }));
  return true;
};

// Only claims Tab/Shift-Tab while the touched line(s) are part of a
// list -- `run` returning false lets CodeMirror fall through to the
// next binding in the keymap. There's no default Tab binding in this
// editor otherwise, so outside a list, Tab keeps doing whatever it did
// before (browser default: move focus).
export const listIndentKeymap: readonly KeyBinding[] = [
  { key: 'Tab', run: indentListLines },
  { key: 'Shift-Tab', run: outdentListLines },
];