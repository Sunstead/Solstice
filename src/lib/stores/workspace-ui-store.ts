import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { createScopedStorage } from './scoped-storage';

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
      storage: createJSONStorage(() => createScopedStorage('workspace-ui.json')),
    },
  ),
);