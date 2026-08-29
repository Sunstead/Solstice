import { create } from 'zustand';

/** How long a revealed row stays highlighted before fading back. */
const HIGHLIGHT_MS = 1500;

interface RevealTargetState {
  path: string | null;
  /**
   * Bumped on every reveal, including a repeat of the path already showing.
   * Rows scroll themselves into view off this rather than off `path` so
   * revealing the same file twice still re-scrolls -- with only a path to
   * watch, the second reveal would be a no-op from React's point of view.
   */
  nonce: number;
  reveal: (path: string) => void;
  clear: () => void;
}

let clearTimer: ReturnType<typeof setTimeout> | undefined;

/**
 * The transient "look here" marker the explorer draws after a reveal. It is
 * deliberately not a selection: nothing in the tree is selectable yet, and a
 * highlight that lingered would read as one.
 */
export const useRevealTarget = create<RevealTargetState>((set) => ({
  path: null,
  nonce: 0,

  reveal: (path) => {
    clearTimeout(clearTimer);
    clearTimer = setTimeout(() => set({ path: null }), HIGHLIGHT_MS);
    set((state) => ({ path, nonce: state.nonce + 1 }));
  },

  clear: () => {
    clearTimeout(clearTimer);
    set({ path: null });
  },
}));
