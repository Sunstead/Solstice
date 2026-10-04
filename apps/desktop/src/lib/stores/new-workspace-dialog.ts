import { create } from 'zustand';

/** The one New workspace dialog, opened from the switcher and the File menu. */
export const useNewWorkspaceDialog = create<{ open: boolean; setOpen: (open: boolean) => void }>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
}));
