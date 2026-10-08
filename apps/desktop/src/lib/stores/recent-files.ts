import { create } from 'zustand';

import { isWithin } from '@/lib/path-utils';

const LIMIT = 20;

/**
 * Files shown most recently, newest first, for the new-tab page and the
 * phone's Search page. By path, so it outlives the tabs that showed them
 * (a phone replaces its one tab as it goes).
 */
interface RecentFilesState {
  paths: string[];
  visit: (path: string) => void;
  forget: (path: string) => void;
  retarget: (from: string, to: string) => void;
  reset: () => void;
}

export const useRecentFiles = create<RecentFilesState>((set) => ({
  paths: [],
  visit: (path) =>
    set((s) => (s.paths[0] === path ? s : { paths: [path, ...s.paths.filter((p) => p !== path)].slice(0, LIMIT) })),
  forget: (path) => set((s) => ({ paths: s.paths.filter((p) => !isWithin(p, path)) })),
  retarget: (from, to) =>
    set((s) => ({ paths: s.paths.map((p) => (isWithin(p, from) ? to + p.slice(from.length) : p)) })),
  reset: () => set({ paths: [] }),
}));
