import { create } from 'zustand';

import type { Jump } from '@/bindings';

/** Where full-text search sent a file's view: taken once by its editor. */
export type FindJump = { path: string; jump: Jump; /** The hit's length, UTF-16. */ length: number };

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
  /** A search hit to show, once its file's editor has loaded. */
  jump: FindJump | null;

  openFor: (path: string) => void;
  close: () => void;
  setQuery: (query: string) => void;
  toggleCaseSensitive: () => void;
  toggleWholeWord: () => void;
  setOptions: (caseSensitive: boolean, wholeWord: boolean) => void;
  requestJump: (path: string, jump: Jump, length: number) => void;
  /** The jump left for `path`, which no other editor then gets. */
  takeJump: (path: string) => FindJump | null;
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
  jump: null,

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

  setOptions: (caseSensitive, wholeWord) => set({ caseSensitive, wholeWord }),

  requestJump: (path, jump, length) => set({ jump: { path, jump, length } }),

  takeJump: (path) => {
    const { jump } = get();
    if (jump?.path !== path) return null;
    set({ jump: null });
    return jump;
  },

  step: (direction) =>
    set({
      stepRequest: {
        direction,
        nonce: (get().stepRequest?.nonce ?? 0) + 1,
      },
    }),

  reportMatches: (matchCount, activeIndex) => set({ matchCount, activeIndex }),
}));
