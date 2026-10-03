import { create } from 'zustand';

/**
 * Which files have edits the editor hasn't written to disk yet.
 *
 * Deliberately separate from `save-status`, which tracks whether a *write* is
 * outstanding and reports nothing at all under `editor.autosave: 'change'`
 * (an instant save has no window worth showing a spinner for). That makes it
 * useless as a "would reloading this lose work?" oracle, which is exactly the
 * question the external-change handling has to answer.
 *
 * Counted rather than flagged for the same reason as `save-status`: two tabs
 * can point at one path.
 */
interface BufferStatusState {
  dirty: Record<string, number>;
}

export const useBufferStatus = create<BufferStatusState>(() => ({ dirty: {} }));

/** Report whether one editor currently holds unsaved edits for `path`. */
export function setBufferDirty(path: string, dirty: boolean) {
  useBufferStatus.setState((state) => {
    const count = state.dirty[path] ?? 0;
    const next = Math.max(0, count + (dirty ? 1 : -1));

    if (next === count) return state;

    const nextDirty = { ...state.dirty };
    if (next === 0) delete nextDirty[path];
    else nextDirty[path] = next;
    return { dirty: nextDirty };
  });
}

/** Imperative read, for the filesystem reconciler. */
export function isBufferDirty(path: string) {
  return (useBufferStatus.getState().dirty[path] ?? 0) > 0;
}

export function useIsBufferDirty(path: string | undefined) {
  return useBufferStatus((s) => (path ? (s.dirty[path] ?? 0) > 0 : false));
}
