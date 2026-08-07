import { create } from 'zustand';

interface ActiveEditorState {
  activeEditorId: string | null;
  setActiveEditor: (id: string | null) => void;
}

export const useActiveEditorStore = create<ActiveEditorState>((set) => ({
  activeEditorId: null,
  setActiveEditor: (id) => set({ activeEditorId: id }),
}));
