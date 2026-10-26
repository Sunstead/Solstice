import { create } from 'zustand';

import type { SectionId } from '@/lib/settings/sections';

/** The phone layout's home pages, one per footer item. */
export type PhonePage = 'files' | 'bookmarks' | 'search' | 'you';

const HISTORY = 50;

/**
 * Where the phone layout is: which home page shows, whether a note is open
 * over it, and the settings pages pushed on You. Also the note history: a
 * phone opens files in its one tab, so going back is by path rather than by
 * tab (the navigation history's unit).
 */
interface PhoneNavState {
  page: PhonePage;
  noteOpen: boolean;
  /** The open note is being swiped most of the way back: the tab bar comes in already. */
  noteLeaving: boolean;
  /** Settings sections pushed on the You page, deepest last. */
  sections: SectionId[];
  /** The section on screen: the top one, or the last while it slides away. */
  section: SectionId | null;
  back: string[];
  forward: string[];

  showPage: (page: PhonePage) => void;
  showNote: () => void;
  goHome: () => void;
  setNoteLeaving: (leaving: boolean) => void;
  pushSection: (id: SectionId) => void;
  popSection: () => void;
  /** Back to You's own page, past every section pushed on it. */
  popSections: () => void;

  /** Records leaving `from` for another note, unless that was a step through history. */
  left: (from: string) => void;
  /** The note to step to, moving `current` onto the other stack; null if none. */
  step: (direction: 'back' | 'forward', current: string | null) => string | null;
  reset: () => void;
}

/** Set while history opens a note, so the change it causes isn't recorded as a visit. */
let stepping = false;

export const usePhoneNav = create<PhoneNavState>((set, get) => ({
  page: 'files',
  noteOpen: false,
  noteLeaving: false,
  sections: [],
  section: null,
  back: [],
  forward: [],

  showPage: (page) => set({ page }),
  showNote: () => set({ noteOpen: true, noteLeaving: false }),
  goHome: () => set({ noteOpen: false, noteLeaving: false }),
  setNoteLeaving: (leaving) => set((s) => (s.noteLeaving === leaving ? s : { noteLeaving: leaving })),
  pushSection: (id) =>
    set((s) => (s.sections[s.sections.length - 1] === id ? s : { sections: [...s.sections, id], section: id })),
  popSection: () =>
    set((s) => {
      const sections = s.sections.slice(0, -1);
      return { sections, section: sections[sections.length - 1] ?? s.section };
    }),

  popSections: () => set((s) => (s.sections.length ? { sections: [] } : s)),

  left: (from) => {
    if (stepping) {
      stepping = false;
      return;
    }
    set((s) => ({ back: [...s.back, from].slice(-HISTORY), forward: [] }));
  },

  step: (direction, current) => {
    const { back, forward } = get();
    const from = direction === 'back' ? back : forward;
    const to = from[from.length - 1];
    if (to === undefined) return null;
    const rest = from.slice(0, -1);
    const other = current ? [...(direction === 'back' ? forward : back), current] : direction === 'back' ? forward : back;
    set(direction === 'back' ? { back: rest, forward: other } : { forward: rest, back: other });
    stepping = current !== null;
    return to;
  },

  reset: () => {
    stepping = false;
    set({ noteOpen: false, noteLeaving: false, sections: [], back: [], forward: [] });
  },
}));
