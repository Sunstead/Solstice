import { create } from 'zustand';

import type { CommandId } from '@/bindings';

interface ActiveEditorState {
  activeEditorId: string | null;
  setActiveEditor: (id: string | null) => void;
  /**
   * Bumped whenever the active editor's ProseMirror selection or
   * document changes (see the commandStateTracker plugin in
   * milkdown-editor.tsx). The number itself carries no meaning --
   * components that need the Format menu's disabled state to track
   * live cursor movement (AppMenubar) subscribe to it purely to force
   * a re-render, since isCommandEnabled() is recomputed fresh on every
   * render and has no subscription mechanism of its own.
   */
  commandStateVersion: number;
  bumpCommandVersion: () => void;
  /** Format commands in effect at the active editor's selection (`activeFormats`). */
  activeFormats: ReadonlySet<string>;
  setActiveFormats: (formats: ReadonlySet<CommandId>) => void;
}

export const useActiveEditorStore = create<ActiveEditorState>((set) => ({
  activeEditorId: null,
  setActiveEditor: (id) => set({ activeEditorId: id }),
  commandStateVersion: 0,
  bumpCommandVersion: () =>
    set((s) => ({ commandStateVersion: s.commandStateVersion + 1 })),
  activeFormats: new Set(),
  setActiveFormats: (formats) => set({ activeFormats: formats }),
}));