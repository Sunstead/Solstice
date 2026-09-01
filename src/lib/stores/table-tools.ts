import { create } from 'zustand';
import type { EditorView } from '@milkdown/kit/prose/view';

export interface TableTarget {
  view: EditorView;
  /** Viewport rectangle of the table's top-left corner. */
  rect: { top: number; left: number };
  /** The selected column's current alignment, for highlighting the active button. */
  alignment: string | null;
}

interface TableToolsState {
  target: TableTarget | null;
  show: (target: TableTarget) => void;
  hide: () => void;
}

/** Same split as find and the link editor: the plugin detects, this shows. */
export const useTableTools = create<TableToolsState>((set) => ({
  target: null,
  show: (target) => set({ target }),
  hide: () => set({ target: null }),
}));
