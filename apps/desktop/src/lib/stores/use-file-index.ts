import { create } from 'zustand';

import { commands } from '@/lib/backend';
import { FileEntry } from '@/bindings';
import { isWithin } from '@/lib/path-utils';

/**
 * Flat, recursive index of every file/folder in the workspace.
 *
 * This is intentionally separate from `useFiles` (the lazy per-directory
 * tree cache used by the sidebar). The tree store only ever holds whatever
 * subtrees the user has expanded; search/quick-open/folder-pick need the
 * whole workspace regardless of expansion state, so they read from here
 * instead.
 */
type FileIndexState = {
  root: string | null;
  files: FileEntry[];
  loading: boolean;
  lastLoadedAt: number | null;

  /**
   * Full re-walk of the workspace. Call on workspace open. False when the
   * walk failed: the index then keeps what it had for this root, since a
   * failed read isn't every file being deleted.
   */
  loadIndex: (root: string) => Promise<boolean>;

  /**
   * Incremental patch for a single path, driven by filesystem-watcher
   * events. Removing a directory removes everything under it.
   */
  upsertEntry: (entry: FileEntry) => void;
  removeEntry: (path: string) => void;

  reset: () => void;
};

export const useFileIndex = create<FileIndexState>((set, get) => ({
  root: null,
  files: [],
  loading: false,
  lastLoadedAt: null,

  loadIndex: async (root) => {
    const sameRoot = get().root === root;
    set({ loading: true, root });

    const res = await commands.listWorkspaceFilesRecursive(root);

    if (res.status === 'error') {
      console.warn(`[file-index] can't walk ${root}: ${res.error}`);
      set((state) => ({ files: sameRoot ? state.files : [], loading: false }));
      return false;
    }

    set({ files: res.data, loading: false, lastLoadedAt: Date.now() });
    return true;
  },

  upsertEntry: (entry) => {
    set((state) => {
      const withoutExisting = state.files.filter((f) => f.path !== entry.path);
      return { files: [...withoutExisting, entry] };
    });
  },

  removeEntry: (path) => {
    set((state) => ({
      files: state.files.filter((f) => !isWithin(f.path, path)),
    }));
  },

  reset: () => set({ root: null, files: [], lastLoadedAt: null }),
}));

/** Convenience selectors */
export const selectAllFiles = (state: FileIndexState) =>
  state.files.filter((f) => !f.is_dir);

export const selectAllFolders = (state: FileIndexState) =>
  state.files.filter((f) => f.is_dir);
