import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { useKnownWorkspaces } from '@/lib/stores/known-workspaces';
import { resetScopedStoreCache } from '@/lib/stores/scoped-storage';
import { useWorkspaceUIStore } from '@/lib/stores/workspace-ui-store';
import { useFiles } from '@/hooks/use-files';
import { useLayout } from '@/hooks/use-layout';
import { commands } from '@/bindings';

type WorkspaceState = {
  path: string | null;
  loading: boolean;
  setPath: (path: string | null) => void;
  init: () => Promise<void>;
  openFolder: () => Promise<void>;
  setWorkspace: (path: string) => Promise<void>;
};

async function syncScopedStores(path: string | null) {
  resetScopedStoreCache();
  await useWorkspaceUIStore.persist.rehydrate();
  if (path) {
    await useLayout.getState().loadForWorkspace(path);
  } else {
    useLayout.setState({ model: null, workspacePath: null });
  }
}

export const useWorkspace = create<WorkspaceState>((set, get) => ({
  path: null,
  loading: true,

  setPath: (path) => set({ path }),

  init: async () => {
    if (!get().loading) return;

    await useKnownWorkspaces.getState().load();

    let path = await invoke<string | null>('get_workspace');

    if (!path) {
      const lastOpened =
        useKnownWorkspaces.getState().workspaces[0]?.path ?? null;
      if (lastOpened) {
        try {
          await commands.setWorkspace(lastOpened);
          path = lastOpened;
        } catch (error) {
          console.error('Failed to restore last workspace:', error);
        }
      }
    }

    set({ path, loading: false });
    await syncScopedStores(path);
  },

  openFolder: async () => {
    const picked = await open({ directory: true });
    if (typeof picked === 'string') {
      await get().setWorkspace(picked);
    }
  },

  setWorkspace: async (path) => {
    await commands.setWorkspace(path);
    await useKnownWorkspaces.getState().touch(path);
    useFiles.getState().reset();
    set({ path });
    await syncScopedStores(path);
  },
}));
