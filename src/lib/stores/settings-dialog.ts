import { create } from 'zustand';
import type { SectionId } from '@/lib/settings/sections';

type SettingsDialogState = {
  open: boolean;
  activeSection: SectionId;
  openSettings: (section?: SectionId) => void;
  setActiveSection: (section: SectionId) => void;
  close: () => void;
};

/**
 * Open state for the single app-wide settings dialog. Centralized -- rather
 * than local state inside the dialog -- so the sidebar button, the
 * `app.settings` command and the native menu can all reach it. Same reasoning
 * as `useFileActionDialog`.
 */
export const useSettingsDialog = create<SettingsDialogState>((set) => ({
  open: false,
  activeSection: 'appearance',
  openSettings: (section) =>
    set(section ? { open: true, activeSection: section } : { open: true }),
  setActiveSection: (activeSection) => set({ activeSection }),
  close: () => set({ open: false }),
}));
