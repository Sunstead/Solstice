import type { EditorView } from '@codemirror/view';

/**
 * CodeMirror instances ProseMirror is currently writing into.
 *
 * Both directions of the bridge have to know when a change originated on the
 * other side, or they echo each other. The flag lives per instance in a
 * module-level set rather than in a React ref because the node view's
 * `setSelection` hook is registered once for the whole `$view` -- it is shared
 * by every code block on the page and has no component closure to read.
 */
const syncing = new WeakSet<EditorView>();

export function isSyncingFromDoc(cm: EditorView): boolean {
  return syncing.has(cm);
}

/** Runs `apply` with the instance marked, so its update listener stands down. */
export function syncFromDoc(cm: EditorView, apply: () => void) {
  syncing.add(cm);
  try {
    apply();
  } finally {
    syncing.delete(cm);
  }
}
