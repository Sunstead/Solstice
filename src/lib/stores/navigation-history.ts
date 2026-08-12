import { create } from 'zustand';

interface NavigationHistoryState {
  past: string[];
  future: string[];
  current: string | null;
  isNavigating: boolean;
  visit: (tabId: string) => void;
  back: () => string | undefined;
  forward: () => string | undefined;
  reset: () => void;
}

export const useNavigationHistory = create<NavigationHistoryState>((set, get) => ({
  past: [],
  future: [],
  current: null,
  isNavigating: false,

  // Called whenever the active tab changes for any reason
  visit: (tabId) => {
    const { current, isNavigating, past } = get();

    // This change was caused by back()/forward() itself -- don't record it
    if (isNavigating) {
      set({ current: tabId, isNavigating: false });
      return;
    }

    if (tabId === current) return;

    set({
      past: current ? [...past, current] : past,
      future: [], // a fresh visit invalidates redo history
      current: tabId,
    });
  },

  back: () => {
    const { past, current, future } = get();
    if (past.length === 0) return undefined;
    const previous = past[past.length - 1];
    set({
      past: past.slice(0, -1),
      future: current ? [current, ...future] : future,
      current: previous,
      isNavigating: true,
    });
    return previous;
  },

  forward: () => {
    const { future, current, past } = get();
    if (future.length === 0) return undefined;
    const next = future[0];
    set({
      future: future.slice(1),
      past: current ? [...past, current] : past,
      current: next,
      isNavigating: true,
    });
    return next;
  },

  reset: () => set({ past: [], future: [], current: null, isNavigating: false }),
}));