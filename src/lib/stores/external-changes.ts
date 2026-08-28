import { create } from 'zustand';

/**
 * Signals from the filesystem reconciler to whichever editors happen to be
 * open on the affected paths.
 *
 * Signals rather than handles, for two reasons: each Milkdown instance lives
 * under its own `MilkdownProvider`, so nothing outside the component can reach
 * it; and two tabs can share one path, so a path-keyed registry of editors
 * couldn't represent them anyway. Each editor subscribes to its own path and
 * reacts independently.
 */
export type ExternalChange =
  | { kind: 'modified'; path: string; at: number }
  | { kind: 'removed'; path: string; at: number };

interface ExternalChangeState {
  changes: Record<string, ExternalChange>;
}

const useExternalChanges = create<ExternalChangeState>(() => ({ changes: {} }));

export function noteExternalChange(change: ExternalChange) {
  useExternalChanges.setState((state) => ({
    changes: { ...state.changes, [change.path]: change },
  }));
}

export function clearExternalChange(path: string) {
  useExternalChanges.setState((state) => {
    if (!(path in state.changes)) return state;
    const changes = { ...state.changes };
    delete changes[path];
    return { changes };
  });
}

export function useExternalChange(path: string | undefined) {
  return useExternalChanges((s) => (path ? s.changes[path] : undefined));
}

/**
 * Bumped after a focus resync so every mounted editor re-checks its own file.
 * The reconciler pushes; it never needs to hold an editor handle.
 */
export const useFsResync = create<{ seq: number }>(() => ({ seq: 0 }));

export const bumpResync = () =>
  useFsResync.setState((s) => ({ seq: s.seq + 1 }));

/**
 * Paths whose pending writes must be dropped rather than flushed, because the
 * file was deleted or renamed out from under the editor.
 *
 * This is load-bearing: the editor flushes its autosaver on unmount and on a
 * path change, and `write_file` calls `create_dir_all` before opening the file
 * -- so a stale flush doesn't just resurrect a deleted note, it resurrects the
 * folder it lived in.
 */
const abandoned = new Set<string>();

export function markAbandoned(path: string) {
  abandoned.add(path);
}

export function clearAbandoned(path: string) {
  abandoned.delete(path);
}

export function isAbandoned(path: string) {
  return abandoned.has(path);
}

/**
 * Stops `path` from being written by whatever editor still holds it.
 *
 * Deliberately not time-limited. The mark has to outlive the flush that runs
 * when the editor unmounts or its path prop changes, and that happens on
 * React's scheduler -- a timer racing it would sometimes lose and let the
 * stale write recreate the file. Instead `createAutosaver` lifts the mark, so
 * it ends exactly when an editor legitimately takes the path over again.
 */
export function abandonPendingWrites(path: string) {
  markAbandoned(path);
}
