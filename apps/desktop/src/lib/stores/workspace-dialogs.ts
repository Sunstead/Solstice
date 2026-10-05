import { create } from 'zustand';

/** The workspace dialogs: make one, import one from sync, or manage the list. One open at a time. */
export type WorkspaceDialog = 'new' | 'import' | 'manage';

export const useWorkspaceDialogs = create<{
  dialog: WorkspaceDialog | null;
  show: (dialog: WorkspaceDialog) => void;
  close: () => void;
}>((set) => ({
  dialog: null,
  show: (dialog) => set({ dialog }),
  close: () => set({ dialog: null }),
}));
