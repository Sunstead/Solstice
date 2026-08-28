import { useMemo } from 'react';
import { create } from 'zustand';

import { commands, FileEntry } from '@/bindings';
import { useSetting } from '@/lib/settings/store';
import { isWithin, normalizePath, parentPath } from '@/lib/path-utils';

export type FileTreeNode = FileEntry & {
  childrenLoaded: boolean;
  expanded: boolean;
};

function pruneSubtree(
  entries: Record<string, FileTreeNode>,
  path: string,
): Record<string, FileTreeNode> {
  return Object.fromEntries(
    Object.entries(entries).filter(
      ([entryPath]) => !isWithin(entryPath, path),
    ),
  );
}

type FilesState = {
  entries: Record<string, FileTreeNode>;

  reset: () => void;
  loadDirectory: (path: string) => Promise<FileTreeNode[]>;
  refreshDirectory: (path: string) => Promise<void>;
  removeSubtree: (path: string) => void;
  expandDirectory: (path: string) => Promise<void>;
  collapseDirectory: (path: string) => void;
};

export interface ChildrenOptions {
  showHidden: boolean;
  foldersFirst: boolean;
}

function compareEntries(a: FileTreeNode, b: FileTreeNode, foldersFirst: boolean) {
  if (foldersFirst && a.is_dir !== b.is_dir) {
    return a.is_dir ? -1 : 1;
  }

  return a.name.localeCompare(b.name, undefined, {
    sensitivity: 'base',
    numeric: true,
  });
}

export function selectChildren(
  entries: Record<string, FileTreeNode>,
  path: string,
  { showHidden, foldersFirst }: ChildrenOptions,
) {
  const normalized = normalizePath(path);

  return Object.values(entries)
    .filter((entry) => parentPath(entry.path) === normalized)
    .filter((entry) => showHidden || !entry.name.startsWith('.'))
    .sort((a, b) => compareEntries(a, b, foldersFirst));
}

/**
 * The tree's view of one directory. Hiding dotfiles and folder ordering are
 * applied here rather than at fetch time, so flipping either setting is
 * instant -- nothing has to be re-read from disk.
 */
export function useDirectoryChildren(path: string) {
  const entries = useFiles((s) => s.entries);
  const showHidden = useSetting('explorer.showHiddenFiles');
  const foldersFirst = useSetting('explorer.foldersFirst');

  return useMemo(
    () => selectChildren(entries, path, { showHidden, foldersFirst }),
    [entries, path, showHidden, foldersFirst],
  );
}

const fetchVisibleEntries = async (path: string) => {
  const res = await commands.listDirectory(path);

  if (res.status === 'error') return [];

  // Everything on disk is kept in the store; `selectChildren` decides what the
  // tree actually shows.
  return res.data;
};

export const useFiles = create<FilesState>((set, get) => ({
  entries: {},

  reset: () => set({ entries: {} }),

  loadDirectory: async (path) => {
    const files = await fetchVisibleEntries(path);

    const nodes = files.map((file) => ({
      ...file,
      childrenLoaded: false,
      expanded: false,
    }));

    set((state) => ({
      entries: {
        ...state.entries,
        ...Object.fromEntries(nodes.map((node) => [node.path, node])),
      },
    }));

    return nodes;
  },

  refreshDirectory: async (path) => {
    const normalizedPath = normalizePath(path);
    const files = await fetchVisibleEntries(path);
    const freshPaths = new Set(files.map((file) => file.path));

    set((state) => {
      let entries = state.entries;

      for (const entry of Object.values(state.entries)) {
        const isStaleChild =
          parentPath(entry.path) === normalizedPath &&
          !freshPaths.has(entry.path);

        if (isStaleChild) {
          entries = pruneSubtree(entries, entry.path);
        }
      }

      const nextEntries = { ...entries };

      for (const file of files) {
        const existing = nextEntries[file.path];

        nextEntries[file.path] = {
          ...file,
          childrenLoaded: existing?.childrenLoaded ?? false,
          expanded: existing?.expanded ?? false,
        };
      }

      return { entries: nextEntries };
    });
  },

  removeSubtree: (path) => {
    set((state) => ({
      entries: pruneSubtree(state.entries, path),
    }));
  },

  expandDirectory: async (path) => {
    const node = get().entries[path];

    if (!node || !node.is_dir) return;

    if (!node.childrenLoaded) {
      await get().loadDirectory(path);
    }

    set((state) => ({
      entries: {
        ...state.entries,
        [path]: {
          ...state.entries[path],
          childrenLoaded: true,
          expanded: true,
        },
      },
    }));
  },

  collapseDirectory: (path) => {
    const node = get().entries[path];

    if (!node) return;

    set((state) => ({
      entries: {
        ...state.entries,
        [path]: {
          ...node,
          expanded: false,
        },
      },
    }));
  },
}));
