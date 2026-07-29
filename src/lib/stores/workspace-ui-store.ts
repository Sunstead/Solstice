import { create } from 'zustand';
import {
  createJSONStorage,
  persist,
  type StateStorage,
} from 'zustand/middleware';
import { load } from '@tauri-apps/plugin-store';

const storePromise = load('workspace-ui.json', { autoSave: true });

const tauriStoreStorage: StateStorage = {
  getItem: async (name) => {
    const store = await storePromise;
    const value = await store.get(name);
    return value ? JSON.stringify(value) : null;
  },
  setItem: async (name, value) => {
    const store = await storePromise;
    await store.set(name, JSON.parse(value));
  },
  removeItem: async (name) => {
    const store = await storePromise;
    await store.delete(name);
  },
};

interface WorkspaceUIState {
  activePrimaryView: string;
  sidebarCollapsed: boolean;
  sidebarWidth: number;
  setActivePrimaryView: (id: string) => void;
  setSidebarCollapsed: (value: boolean) => void;
  setSidebarWidth: (width: number) => void;
}

export const useWorkspaceUIStore = create<WorkspaceUIState>()(
  persist(
    (set) => ({
      activePrimaryView: 'notes',
      sidebarCollapsed: false,
      sidebarWidth: 260,
      setActivePrimaryView: (id) => set({ activePrimaryView: id }),
      setSidebarCollapsed: (value) => set({ sidebarCollapsed: value }),
      setSidebarWidth: (width) => set({ sidebarWidth: width }),
    }),
    {
      name: 'workspace-ui',
      storage: createJSONStorage(() => tauriStoreStorage),
    },
  ),
);
