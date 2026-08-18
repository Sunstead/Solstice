import { create } from 'zustand';
import type { MovableEntry } from '@/lib/file-operations';

type FileTreeDragState = {
  draggedEntry: MovableEntry | null;
  setDraggedEntry: (entry: MovableEntry | null) => void;
};

export const useFileTreeDragState = create<FileTreeDragState>((set) => ({
  draggedEntry: null,
  setDraggedEntry: (entry) => set({ draggedEntry: entry }),
}));