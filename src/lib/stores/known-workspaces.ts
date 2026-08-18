import { create } from 'zustand';
import { load } from '@tauri-apps/plugin-store';

export interface KnownWorkspace {
  path: string;
  name: string;
  lastOpenedAt: number;
}

const STORE_FILE = 'known-workspaces.json';
const STORE_KEY = 'workspaces';

function getStore() {
  return load(STORE_FILE, { autoSave: true });
}

function nameFromPath(path: string) {
  return path.split(/[\\/]/).pop() ?? path;
}

interface KnownWorkspacesState {
  workspaces: KnownWorkspace[];
  load: () => Promise<void>;
  touch: (path: string) => Promise<void>;
}

export const useKnownWorkspaces = create<KnownWorkspacesState>((set) => ({
  workspaces: [],

  load: async () => {
    const store = await getStore();
    const workspaces = (await store.get<KnownWorkspace[]>(STORE_KEY)) ?? [];
    set({ workspaces });
  },

  touch: async (path) => {
    const store = await getStore();
    const list = (await store.get<KnownWorkspace[]>(STORE_KEY)) ?? [];
    const workspaces = [
      { path, name: nameFromPath(path), lastOpenedAt: Date.now() },
      ...list.filter((w) => w.path !== path),
    ];
    await store.set(STORE_KEY, workspaces);
    set({ workspaces });
  },
}));
