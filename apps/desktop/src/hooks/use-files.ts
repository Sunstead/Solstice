import { useMemo } from 'react';
import { create } from 'zustand';

import { commands } from '@/lib/backend';
import { FileEntry } from '@/bindings';
import { useSetting } from '@/lib/settings/store';
import { useWorkspaceUIStore } from '@/lib/stores/workspace-ui-store';
import {
  isSamePath,
  isWithin,
  normalizePath,
  parentOf,
  parentPath,
} from '@/lib/path-utils';

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
  loadRoot: (root: string) => Promise<void>;
  loadDirectory: (path: string) => Promise<FileTreeNode[]>;
  refreshDirectory: (path: string) => Promise<void>;
  removeSubtree: (path: string) => void;
  restoreExpandedFolders: (root: string) => Promise<void>;
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

  loadRoot: async (root) => {
    await get().loadDirectory(root);
    await get().restoreExpandedFolders(root);
  },

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
    useWorkspaceUIStore.getState().forgetExpandedSubtree(path);

    set((state) => ({
      entries: pruneSubtree(state.entries, path),
    }));
  },

  /**
   * Reopens the folders `workspace-ui.json` remembers, so the tree comes back
   * shaped the way it was left. Level by level rather than all at once: a
   * folder's children only enter the store once its parent has been read, and
   * `expandDirectory` ignores a path it has never seen.
   */
  restoreExpandedFolders: async (root) => {
    const saved = useWorkspaceUIStore.getState().expandedFolders;
    if (saved.length === 0) return;

    const depth = (path: string) => normalizePath(path).split('/').length;
    const levels = [...new Set(saved.map(depth))].sort((a, b) => a - b);

    for (const level of levels) {
      await Promise.all(
        saved
          .filter((path) => depth(path) === level)
          .map((path) => get().expandDirectory(path)),
      );
    }

    // A folder whose parent was read but which is not in it was deleted while
    // the workspace was closed; anything still unreachable (its parent is
    // collapsed, so it was never read) is kept -- it is cached state, not dead.
    const { entries } = get();
    const wasRead = (path: string) => {
      const parent = parentOf(path);
      return isSamePath(parent, root) || entries[parent]?.childrenLoaded === true;
    };

    const alive = saved.filter((path) => entries[path] !== undefined || !wasRead(path));
    if (alive.length !== saved.length) {
      useWorkspaceUIStore.getState().setExpandedFolders(alive);
    }
  },

  expandDirectory: async (path) => {
    const node = get().entries[path];

    if (!node || !node.is_dir) return;

    if (!node.childrenLoaded) {
      await get().loadDirectory(path);
    }

    useWorkspaceUIStore.getState().setFolderExpanded(path, true);

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

    useWorkspaceUIStore.getState().setFolderExpanded(path, false);

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
