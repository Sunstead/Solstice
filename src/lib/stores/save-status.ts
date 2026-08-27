import { create } from 'zustand';

/**
 * Which files currently have an unwritten edit.
 *
 * Counted rather than flagged because more than one editor can be open on the
 * same file -- drag-opened tabs no longer use the path as their id, so two
 * tabs can point at one path (see `handleExternalDrag`). Each autosaver
 * reports its own transitions and the count keeps them from cancelling each
 * other out.
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
