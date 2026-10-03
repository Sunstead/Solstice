import { create } from 'zustand';

interface FindState {
  /**
   * Which file's editor is showing the find bar, or `null` for none. One bar
   * app-wide, keyed by path rather than by editor instance: the trigger in the
   * editor header knows its own path but holds no editor handle, and
   * `activeEditorId` tracks the last *focused* editor, which is not
   * necessarily the tab whose header was just clicked.
   */
  openPath: string | null;
  query: string;
  caseSensitive: boolean;
  wholeWord: boolean;
  /** Reported back by the plugin once it has scanned the document. */
  matchCount: number;
  activeIndex: number;
  /** Bumped to ask the open editor to step; sign gives the direction. */
  stepRequest: { direction: 1 | -1; nonce: number } | null;
  /** Bumped on every open request, so re-opening re-focuses the input. */
  focusNonce: number;

  openFor: (path: string) => void;
  close: () => void;
  setQuery: (query: string) => void;
  toggleCaseSensitive: () => void;
  toggleWholeWord: () => void;
  step: (direction: 1 | -1) => void;
  reportMatches: (matchCount: number, activeIndex: number) => void;
}

export const useFindStore = create<FindState>((set, get) => ({
  openPath: null,
  query: '',
  caseSensitive: false,
  wholeWord: false,
  matchCount: 0,
  activeIndex: -1,
  stepRequest: null,
  focusNonce: 0,

  // The query survives closing and reopening within a session -- the same
  // "find the next one of these" expectation every editor sets.
  openFor: (path) =>
    set((state) => ({
      openPath: path,
      // Counts are reported by the open editor when something changes. Asking
      // again for the file already showing produces no transaction and so no
      // new report, which is why the existing counts have to be kept: zeroing
      // them here would leave the bar reading "No results" over live matches.
      matchCount: state.openPath === path ? state.matchCount : 0,
      activeIndex: state.openPath === path ? state.activeIndex : -1,
      stepRequest: null,
      focusNonce: state.focusNonce + 1,
    })),

  close: () => set({ openPath: null, stepRequest: null }),

  setQuery: (query) => set({ query }),

  toggleCaseSensitive: () =>
    set((state) => ({ caseSensitive: !state.caseSensitive })),

  toggleWholeWord: () => set((state) => ({ wholeWord: !state.wholeWord })),

  step: (direction) =>
    set({
      stepRequest: {
        direction,
        nonce: (get().stepRequest?.nonce ?? 0) + 1,
      },
    }),

  reportMatches: (matchCount, activeIndex) => set({ matchCount, activeIndex }),
}));
