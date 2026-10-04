import { create } from 'zustand';
import { commands } from '@/lib/backend';
import { open } from '@/lib/backend/shell';
import { useKnownWorkspaces } from '@/lib/stores/known-workspaces';
import { resetScopedStoreCache } from '@/lib/stores/scoped-storage';
import { useWorkspaceUIStore } from '@/lib/stores/workspace-ui-store';
import { loadWorkspaceSettings } from '@/lib/settings/store';
import { useThemeCatalogue } from '@/lib/theme/store';
import { useFiles } from '@/hooks/use-files';
import { useFileIndex } from '@/lib/stores/use-file-index';
import { useWikilinkIndex } from '@/lib/stores/wikilink-index';
import { useLayout } from '@/hooks/use-layout';

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
  await loadWorkspaceSettings();
  // Themes live in the workspace too, so the catalogue is workspace state like
  // the settings above it.
  await useThemeCatalogue.getState().reload();

  if (path) {
    await useLayout.getState().loadForWorkspace(path);
    // After the rehydrate above, so the tree can reopen the folders the
    // workspace-ui store remembers.
    await useFiles.getState().loadRoot(path);
    await useFileIndex.getState().loadIndex(path);
  } else {
    useLayout.setState({ model: null, workspacePath: null });
    useFiles.getState().reset();
    useFileIndex.getState().reset();
    // Closing the workspace is the one case where dropping the snapshot
    // outright is right -- there is nothing left for links to resolve against.
    useWikilinkIndex.getState().invalidate();
  }
}

export const useWorkspace = create<WorkspaceState>((set, get) => ({
  path: null,
  loading: true,

  setPath: (path) => set({ path }),

  init: async () => {
    if (!get().loading) return;

    await useKnownWorkspaces.getState().load();

    let path = await commands.getWorkspace();

    if (!path) {
      const lastOpened =
        useKnownWorkspaces.getState().workspaces[0]?.path ?? null;
      if (lastOpened) {
        // A failed watcher is not a failed open: the workspace is still
        // usable, it just won't see external changes until the next focus
        // resync. Restoring must not be blocked on it.
        const result = await commands.setWorkspace(lastOpened);
        if (result.status === 'error') {
          console.error('Failed to watch workspace:', result.error);
        }
        path = lastOpened;
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
    const result = await commands.setWorkspace(path);
    if (result.status === 'error') {
      console.error('Failed to watch workspace:', result.error);
    }
    await useKnownWorkspaces.getState().touch(path);
    useFiles.getState().reset();
    set({ path });
    await syncScopedStores(path);
  },
}));
