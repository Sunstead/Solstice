import { create } from 'zustand';
import type { SectionId } from '@/lib/settings/sections';

type SettingsDialogState = {
  open: boolean;
  activeSection: SectionId;
  /** Search spans every section, so it lives beside the active one, not in it. */
  query: string;
  openSettings: (section?: SectionId) => void;
  setActiveSection: (section: SectionId) => void;
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
  openSettings: (section) =>
    set((state) =>
      state.open
        ? { open: false, query: '' }
        : section
          ? { open: true, activeSection: section, query: '' }
          : { open: true, query: '' },
    ),
  setActiveSection: (activeSection) => set({ activeSection, query: '' }),
  setQuery: (query) => set({ query }),
  close: () => set({ open: false, query: '' }),
}));
