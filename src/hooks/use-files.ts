import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';

import { FileEntry } from '@/generated/FileEntry';

export type FileTreeNode = FileEntry & {
  childrenLoaded: boolean;
  expanded: boolean;
};

function getParentPath(path: string) {
  const normalized = path.replace(/\\/g, '/');
  const index = normalized.lastIndexOf('/');

  if (index === -1) return '';

  return normalized.substring(0, index);
}

type FilesState = {
  entries: Record<string, FileTreeNode>;

  reset: () => void;
  loadDirectory: (path: string) => Promise<FileTreeNode[]>;
  expandDirectory: (path: string) => Promise<void>;
  collapseDirectory: (path: string) => void;
};

export function selectChildren(
  entries: Record<string, FileTreeNode>,
  path: string,
) {
  const normalized = path.replace(/\\/g, '/');

  return Object.values(entries).filter((entry) => {
    return getParentPath(entry.path) === normalized;
  });
}

export const useFiles = create<FilesState>((set, get) => ({
  entries: {},

  reset: () => set({ entries: {} }),

  loadDirectory: async (path) => {
    const files = await invoke<FileEntry[]>('list_directory', { path });

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
