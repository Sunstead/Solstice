import { create } from 'zustand';

import type { Results } from '@/bindings';
import { commands } from '@/lib/backend';

/**
 * Full-text search: the query, its options and what came back. One per
 * window, shared by the sidebar's Search view and the phone's Search page.
 * The index itself is the backend's (`solstice-search`), so a search is one
 * call.
 */
type SearchState = {
  query: string;
  caseSensitive: boolean;
  wholeWord: boolean;
  /** `null` until something's been searched for. */
  results: Results | null;
  pending: boolean;
  /** Why the last search failed; its results are kept. */
  error: string | null;
  /** Bumped to focus the field (Find in Files). */
  focusNonce: number;

  setQuery: (query: string) => void;
  toggleCaseSensitive: () => void;
  toggleWholeWord: () => void;
  /** Focuses the field, with `query` in it if given. */
  focus: (query?: string) => void;
  /** Searches the workspace at `root` for the current query. */
  run: (root: string, excludes: string[]) => Promise<void>;
};

/** Which search is the latest: an older one's reply is dropped. */
let generation = 0;

export const useSearchStore = create<SearchState>((set, get) => ({
  query: '',
  caseSensitive: false,
  wholeWord: false,
  results: null,
  pending: false,
  error: null,
  focusNonce: 0,

  setQuery: (query) => set({ query }),
  toggleCaseSensitive: () => set((s) => ({ caseSensitive: !s.caseSensitive })),
  toggleWholeWord: () => set((s) => ({ wholeWord: !s.wholeWord })),
  focus: (query) => set((s) => ({ query: query ?? s.query, focusNonce: s.focusNonce + 1 })),

  run: async (root, excludes) => {
    const mine = ++generation;
    const { query, caseSensitive, wholeWord } = get();
    if (!query) {
      set({ results: null, pending: false, error: null });
      return;
    }
    set({ pending: true });
    const res = await commands.searchWorkspace(
      root,
      { text: query, case_sensitive: caseSensitive, whole_word: wholeWord },
      excludes,
    );
    if (mine !== generation) return;
    if (res.status === 'error') set({ pending: false, error: res.error });
    else set({ pending: false, error: null, results: res.data });
  },
}));

/** The `search.exclude` setting as a list. */
export function parseExcludes(setting: string): string[] {
  return setting
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}
