import { EditorState, ChangeSpec } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';

// Normalizes unordered list markers ("*" and "+") to "-" so a document
// never ends up mixing bullet characters. Only touches ListMark nodes
// that are direct children of a ListItem inside a BulletList --
// ordered-list markers ("1.", "2)") live under OrderedList and are left
// alone.
//
// Exported separately from the transactionFilter below so FileEditor.tsx
// can also run it once, up front, against a freshly loaded file (the
// filter only fires on transactions dispatched *after* the editor
// exists, so a file that already mixes "*"/"-" on disk wouldn't
// otherwise get cleaned up until the user happened to edit one of those
// lines).
export function bulletNormalizationChanges(state: EditorState): ChangeSpec[] {
  const changes: ChangeSpec[] = [];

  syntaxTree(state).iterate({
    enter: (node) => {
      if (node.name !== 'ListMark') return;

      const item = node.node.parent;
      if (!item || item.name !== 'ListItem') return;
      if (item.parent?.name !== 'BulletList') return;

      const marker = state.doc.sliceString(node.from, node.to);
      if (marker !== '-') {
        changes.push({ from: node.from, to: node.to, insert: '-' });
      }
    },
  });

  return changes;
}

// Wired up as a transactionFilter rather than a transactionExtender:
// extenders may only add annotations/effects to a transaction, not new
// changes, and this needs to append real text edits on top of whatever
// the user just typed. `tr.state` is the state the transaction would
// produce on its own (CodeMirror computes it on demand for exactly this
// kind of filter); we scan that, then bolt a second, sequential set of
// changes onto the SAME transaction so the whole thing lands as one
// atomic edit and one undo step -- calling view.dispatch() a second time
// from inside a plugin's update() isn't safe (CodeMirror throws if you
// dispatch while an update from the current transaction is still being
// processed), so folding it into the original transaction is the
// correct mechanism here, not a workaround.
//
// Note: this re-scans the *whole* document's syntax tree on every
// keystroke, same as the live-preview decoration builder does for its
// visible range. Fine for note-sized files; if it ever shows up in
// profiling on very large documents, restrict the walk to the lines
// touched by `tr.changes` instead.
export const normalizeBulletMarkers = EditorState.transactionFilter.of((tr) => {
  if (!tr.docChanged) return tr;

  const changes = bulletNormalizationChanges(tr.state);
  if (!changes.length) return tr;

  return [tr, { changes, sequential: true }];
});