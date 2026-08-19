import { create } from 'zustand';

import { commands, FileEntry } from '@/bindings';

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

  /** Full re-walk of the workspace. Call on workspace open. */
  loadIndex: (root: string) => Promise<void>;

  /**
   * Incremental patch for a single path, driven by filesystem-watcher
   * events. Removing a directory removes everything under it.
   */
  upsertEntry: (entry: FileEntry) => void;
  removeEntry: (path: string) => void;

  reset: () => void;
};

function normalize(path: string) {
  return path.replace(/\\/g, '/');
}

function isWithinSubtree(entryPath: string, rootPath: string) {
  const normalizedEntry = normalize(entryPath);
  const normalizedRoot = normalize(rootPath);

  return (
    normalizedEntry === normalizedRoot ||
    normalizedEntry.startsWith(`${normalizedRoot}/`)
  );
}

export const useFileIndex = create<FileIndexState>((set, get) => ({
  root: null,
  files: [],
  loading: false,
  lastLoadedAt: null,

  loadIndex: async (root) => {
    set({ loading: true, root });

    const res = await commands.listWorkspaceFilesRecursive(root);

    set({
      files: res.status === 'ok' ? res.data : [],
      loading: false,
      lastLoadedAt: Date.now(),
    });
  },

  upsertEntry: (entry) => {
    set((state) => {
      const withoutExisting = state.files.filter((f) => f.path !== entry.path);
      return { files: [...withoutExisting, entry] };
    });
  },

  removeEntry: (path) => {
    set((state) => ({
      files: state.files.filter((f) => !isWithinSubtree(f.path, path)),
    }));
  },

  reset: () => set({ root: null, files: [], lastLoadedAt: null }),
}));

/** Convenience selectors */
export const selectAllFiles = (state: FileIndexState) =>
  state.files.filter((f) => !f.is_dir);

export const selectAllFolders = (state: FileIndexState) =>
  state.files.filter((f) => f.is_dir);
