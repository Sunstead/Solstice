import { create } from 'zustand';

/** The folder whose color is being picked by hand (the menu's Custom…), if any. */
export const useFolderColorDialog = create<{
  path: string | null;
  open: (path: string) => void;
  close: () => void;
}>((set) => ({
  path: null,
  open: (path) => set({ path }),
  close: () => set({ path: null }),
}));
