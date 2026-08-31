import { create } from 'zustand';
import type { EditorView } from '@milkdown/kit/prose/view';

export interface LinkTarget {
  view: EditorView;
  from: number;
  to: number;
  href: string;
  /** Viewport rectangle of the link, for positioning the editor. */
  rect: { top: number; bottom: number; left: number };
}

interface LinkEditorState {
  target: LinkTarget | null;
  /** Set when the user asks to edit, rather than merely visiting the link. */
  editing: boolean;
  show: (target: LinkTarget) => void;
  hide: () => void;
  setEditing: (editing: boolean) => void;
}

/**
 * Mirrors how find works: the ProseMirror plugin owns the detection and this
 * store owns what the UI shows, with traffic in one direction only.
 */
export const useLinkEditor = create<LinkEditorState>((set) => ({
  target: null,
  editing: false,
  show: (target) => set({ target }),
  hide: () => set({ target: null, editing: false }),
  setEditing: (editing) => set({ editing }),
}));
