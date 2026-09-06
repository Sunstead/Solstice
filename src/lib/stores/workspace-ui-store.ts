import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { isSamePath, isWithin } from '@/lib/path-utils';
import { createScopedStorage } from './scoped-storage';

interface WorkspaceUIState {
  activePrimaryView: string;
  sidebarCollapsed: boolean;
  sidebarWidth: number;
  /**
   * Folders the explorer tree has open, as the OS-native paths `useFiles`
   * keys its entries by -- the same form `layout.json` stores tab paths in,
   * so both files stay readable and hand-editable.
   */
  expandedFolders: string[];
  setActivePrimaryView: (id: string) => void;
  setSidebarCollapsed: (value: boolean) => void;
  setSidebarWidth: (width: number) => void;
  setFolderExpanded: (path: string, expanded: boolean) => void;
  forgetExpandedSubtree: (path: string) => void;
  setExpandedFolders: (paths: string[]) => void;
}

export const useWorkspaceUIStore = create<WorkspaceUIState>()(
  persist(
    (set) => ({
      activePrimaryView: 'notes',
      sidebarCollapsed: false,
      sidebarWidth: 260,
      expandedFolders: [],
      setActivePrimaryView: (id) => set({ activePrimaryView: id }),
      setSidebarCollapsed: (value) => set({ sidebarCollapsed: value }),
      setSidebarWidth: (width) => set({ sidebarWidth: width }),

      setFolderExpanded: (path, expanded) =>
        set((state) => {
          const known = state.expandedFolders.some((p) => isSamePath(p, path));

          // Returning the same state matters here: expanding is re-applied on
          // every restore, and each write hits disk.
          if (expanded) {
            return known
              ? state
              : { expandedFolders: [...state.expandedFolders, path] };
          }

          return known
            ? {
                expandedFolders: state.expandedFolders.filter(
                  (p) => !isSamePath(p, path),
                ),
              }
            : state;
        }),

      forgetExpandedSubtree: (path) =>
        set((state) => ({
          expandedFolders: state.expandedFolders.filter(
            (p) => !isWithin(p, path),
          ),
        })),

      setExpandedFolders: (paths) => set({ expandedFolders: paths }),
    }),
    {
      name: 'workspace-ui',
      storage: createJSONStorage(() => createScopedStorage('workspace-ui.json')),
    },
  ),
);
