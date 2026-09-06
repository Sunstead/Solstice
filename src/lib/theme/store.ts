import { create } from 'zustand';
import { commands } from '@/bindings';
import { builtinThemes } from './builtin';
import { loadUserThemes, type ThemeLoadIssue } from './load';
import type { CatalogueTheme } from './types';

interface ThemeCatalogue {
  /** Built-ins first, then whatever the theme folders hold. */
  themes: CatalogueTheme[];
  issues: ThemeLoadIssue[];
  loading: boolean;
  reload: () => Promise<void>;
}

/**
 * The catalogue of available themes. Which one is *selected* lives in settings
 * like every other preference; this store only knows what there is to choose
 * from, so it is deliberately not persisted -- it is a view of the disk.
 */
export const useThemeCatalogue = create<ThemeCatalogue>((set) => ({
  themes: builtinThemes,
  issues: [],
  loading: false,

  reload: async () => {
    set({ loading: true });
    try {
      const result = await commands.listUserThemes();
      if (result.status === 'error') throw new Error(result.error);
      const { themes, issues } = loadUserThemes(result.data);
      set({ themes: [...builtinThemes, ...themes], issues, loading: false });
    } catch (error) {
      console.error('Failed to load user themes:', error);
      set({ themes: builtinThemes, loading: false });
    }
  },
}));

/** Non-reactive lookup, for the settings registry's dynamic option lists. */
export function themeById(id: string) {
  return useThemeCatalogue.getState().themes.find((t) => t.id === id);
}

export function themeOptions(appearance?: 'light' | 'dark') {
  return useThemeCatalogue
    .getState()
    .themes.filter((t) => !appearance || t.appearance === appearance)
    .map((t) => ({ value: t.id, label: t.name }));
}
