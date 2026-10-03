import { create } from 'zustand';

interface DragHoverState {
  hoverTargetPath: string | null;
  setHoverTarget: (path: string) => void;
  clearHoverTarget: (path: string) => void;
}

/**
 * Tracks which directory a drag is currently hovering over as a drop
 * target, keyed by path rather than by DOM node.
 *
 * A file's drop zone and its parent folder's row (and children container)
 * are separate, unrelated DOM elements, so react-dnd's own per-target
 * `isOver` can't tell the folder "hovering one of your files counts as
 * hovering you too." Resolving to a shared path instead lets any component
 * whose path matches the current target highlight itself, regardless of
 * which specific element the pointer is actually over.
 */
export const useDragHoverStore = create<DragHoverState>((set, get) => ({
  hoverTargetPath: null,
  setHoverTarget: (path) => set({ hoverTargetPath: path }),
  clearHoverTarget: (path) => {
    // Only clear if nothing else has claimed the target since - avoids a
    // leaving drop zone stomping on one that's already been entered.
    if (get().hoverTargetPath === path) {
      set({ hoverTargetPath: null });
    }
  },
}));