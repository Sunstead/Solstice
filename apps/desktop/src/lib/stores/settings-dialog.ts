import { create } from 'zustand';
import type { SectionId } from '@/lib/settings/sections';

type SettingsDialogState = {
  open: boolean;
  activeSection: SectionId;
  /** Search spans every section, so it lives beside the active one, not in it. */
  query: string;
  /** The section the last `openSettings` asked for, if it named one. */
  requested: SectionId | null;
  /**
   * The section pushed as a page over the list (the touch dialog), or null
   * on the list. `shown` is what that page renders: it stays set while the
   * page slides away.
   */
  page: SectionId | null;
  shown: SectionId | null;
  openSettings: (section?: SectionId) => void;
  setActiveSection: (section: SectionId) => void;
  pushPage: (section: SectionId) => void;
  popPage: () => void;
  setQuery: (query: string) => void;
  close: () => void;
};

/**
 * Open state for the single app-wide settings dialog, centralized so the
 * sidebar button, the `app.settings` command and the native menu all reach the
 * same instance. Same reasoning as `useFileActionDialog`.
 *
 * Every transition clears the search: a stale query would otherwise hide the
 * section the caller asked for.
 */
export const useSettingsDialog = create<SettingsDialogState>((set) => ({
  open: false,
  activeSection: 'appearance',
  query: '',
  requested: null,
  page: null,
  shown: null,
  openSettings: (section) =>
    set((state) =>
      state.open
        ? { open: false, query: '', page: null }
        : section
          ? { open: true, activeSection: section, query: '', requested: section, page: section, shown: section }
          : { open: true, query: '', requested: null, page: null },
    ),
  setActiveSection: (activeSection) => set({ activeSection, query: '' }),
  pushPage: (section) => set({ page: section, shown: section, activeSection: section, query: '' }),
  popPage: () => set({ page: null }),
  setQuery: (query) => set({ query }),
  close: () => set({ open: false, query: '', page: null }),
}));
