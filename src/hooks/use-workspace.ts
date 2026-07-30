import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { touchKnownWorkspace } from '@/lib/stores/known-workspaces';
import { useFiles } from '@/hooks/use-files';

type WorkspaceState = {
  path: string | null;
  loading: boolean;
  setPath: (path: string | null) => void;
  init: () => Promise<void>;
  openFolder: () => Promise<void>;
  setWorkspace: (path: string) => Promise<void>;
};

export const useWorkspace = create<WorkspaceState>((set, get) => ({
  path: null,
  loading: true,

  setPath: (path) => set({ path }),

  init: async () => {
    if (!get().loading) return;
    const path = await invoke<string | null>('get_workspace');
    set({ path, loading: false });
  },

  openFolder: async () => {
    const picked = await open({ directory: true });
    if (typeof picked === 'string') {
      await get().setWorkspace(picked);
    }
  },

  setWorkspace: async (path) => {
    await invoke('set_workspace', { path });
    await touchKnownWorkspace(path);
    useFiles.getState().reset();
    set({ path });
  },
}));