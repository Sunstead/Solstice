import { create } from 'zustand';

/**
 * Which files currently have an unwritten edit.
 *
 * Counted rather than flagged because two tabs can point at one path — tab ids
 * are independent of the file path (see `handleExternalDrag`). Each autosaver
 * reports its own transitions and the count keeps them from cancelling out.
 */
interface SaveStatusState {
  saving: Record<string, number>;
}

export const useSaveStatus = create<SaveStatusState>(() => ({ saving: {} }));

/** Report whether one autosaver currently has work outstanding for `path`. */
export function setSaving(path: string, active: boolean) {
  useSaveStatus.setState((state) => {
    const count = state.saving[path] ?? 0;
    const next = Math.max(0, count + (active ? 1 : -1));

    if (next === count) return state;

    const saving = { ...state.saving };
    if (next === 0) delete saving[path];
    else saving[path] = next;
    return { saving };
  });
}

export function useIsSaving(path: string | undefined) {
  return useSaveStatus((s) => (path ? (s.saving[path] ?? 0) > 0 : false));
}

/**
 * Files whose last write failed, with why. The edit is still in the editor and
 * the autosaver keeps retrying; this is only what the user is told.
 */
export const useSaveFailures = create<{ failed: Record<string, string> }>(() => ({
  failed: {},
}));

export function setSaveFailed(path: string, message: string | null) {
  useSaveFailures.setState((state) => {
    if ((state.failed[path] ?? null) === message) return state;
    const failed = { ...state.failed };
    if (message === null) delete failed[path];
    else failed[path] = message;
    return { failed };
  });
}

export function useSaveFailure(path: string | undefined) {
  return useSaveFailures((s) => (path ? (s.failed[path] ?? null) : null));
}
