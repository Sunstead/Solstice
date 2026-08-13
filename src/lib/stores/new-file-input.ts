import { create } from 'zustand';

interface NewFileInputState {
  parentPath: string | null;
  startNewFile: (parentPath: string) => void;
  cancelNewFile: () => void;
}

export const useNewFileInput = create<NewFileInputState>((set) => ({
  parentPath: null,
  startNewFile: (parentPath) => set({ parentPath }),
  cancelNewFile: () => set({ parentPath: null }),
}));