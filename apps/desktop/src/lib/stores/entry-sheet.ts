import { create } from 'zustand';

import type { EntryTarget } from '@/lib/entry-actions';

/**
 * Where a hold sheet was opened: the tree (which is already the file's place,
 * so it doesn't offer to show it there), another list, or a note's ⋯ (which
 * adds what only an open note has, and may have no file: a blank page).
 */
export type EntrySheetFrom = 'tree' | 'list' | 'note';

/** The phone's hold sheet (`EntrySheet`): what it's for, while it shows. */
interface EntrySheetState {
  shown: boolean;
  entry: EntryTarget | null;
  from: EntrySheetFrom;
  open: (entry: EntryTarget | null, from?: EntrySheetFrom) => void;
  close: () => void;
}

export const useEntrySheet = create<EntrySheetState>((set) => ({
  shown: false,
  entry: null,
  from: 'list',
  open: (entry, from = 'list') => set({ shown: true, entry, from }),
  // The entry stays while the sheet slides away.
  close: () => set({ shown: false }),
}));
