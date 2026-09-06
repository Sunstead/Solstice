import { useEffect } from 'react';
import { getSetting, setSetting, useSetting } from '@/lib/settings/store';
import { applyTheme } from '@/lib/theme/apply';
import {
  DEFAULT_LIGHT_THEME_ID,
  DEFAULT_THEME_ID,
  builtinThemes,
} from '@/lib/theme/builtin';
import { useThemeCatalogue } from '@/lib/theme/store';
import type { CatalogueTheme } from '@/lib/theme/types';

export type Appearance = 'light' | 'dark';

function prefersDark() {
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

/**
 * The theme for an id, falling back to a built-in whenever the id no longer
 * resolves -- a user theme whose file was deleted, or a settings file carried
 * over from a build that had a theme this one does not.
 */
function themeFor(themes: CatalogueTheme[], id: string, appearance: Appearance) {
  const fallbackId =
    appearance === 'light' ? DEFAULT_LIGHT_THEME_ID : DEFAULT_THEME_ID;
  return (
    themes.find((t) => t.id === id)
    ?? themes.find((t) => t.id === fallbackId)
    ?? builtinThemes[0]
  );
}

/** The id and appearance the current settings select, resolving `system`. */
function selection(dark: boolean) {
  if (getSetting('theme.mode') === 'system') {
    return dark
      ? ({ id: getSetting('theme.darkPreset'), appearance: 'dark' } as const)
      : ({ id: getSetting('theme.lightPreset'), appearance: 'light' } as const);
  }
  const id = getSetting('theme.preset');
  const known = useThemeCatalogue.getState().themes.find((t) => t.id === id);
  return { id, appearance: known?.appearance ?? 'dark' } as const;
}

/**
 * Keeps the document root painted with the selected theme. Under
 * `theme.mode: system` it keeps tracking the OS rather than sampling the
 * preference once, so the palette flips the moment the system does.
 */
export function useThemeEffect() {
  const mode = useSetting('theme.mode');
  const preset = useSetting('theme.preset');
  const lightPreset = useSetting('theme.lightPreset');
  const darkPreset = useSetting('theme.darkPreset');
  // Re-runs when themes are loaded or reloaded from disk, which is what makes
  // a freshly dropped-in theme file take effect without a restart.
  const themes = useThemeCatalogue((s) => s.themes);

  useEffect(() => {
    const paint = () => {
      const { id, appearance } = selection(prefersDark());
      const theme = themeFor(themes, id, appearance);
      applyTheme(theme);
      rememberThemeChoice(theme);
    };

    paint();
    if (mode !== 'system') return;

    const query = window.matchMedia('(prefers-color-scheme: dark)');
    query.addEventListener('change', paint);
    return () => query.removeEventListener('change', paint);
  }, [mode, preset, lightPreset, darkPreset, themes]);
}

/** The appearance in effect right now, resolving `system`. */
export function resolvedTheme(): Appearance {
  return selection(prefersDark()).appearance;
}

export function useTheme() {
  const themes = useThemeCatalogue((s) => s.themes);
  const mode = useSetting('theme.mode');
  const preset = useSetting('theme.preset');

  return {
    mode,
    theme: themeFor(themes, preset, 'dark'),
    /**
     * Flips to the other appearance, keeping the user on a theme they chose
     * where possible: the last theme they used with that appearance, else that
     * appearance's built-in default. From `system` mode this also pins the
     * choice, since there is nothing else a manual flip could mean.
     */
    toggleAppearance: () => {
      const next: Appearance = resolvedTheme() === 'dark' ? 'light' : 'dark';
      const remembered = lastUsed[next];
      const id =
        themes.find((t) => t.id === remembered)?.id
        ?? (next === 'light' ? DEFAULT_LIGHT_THEME_ID : DEFAULT_THEME_ID);

      if (mode === 'system') setSetting('theme.mode', 'fixed');
      setSetting('theme.preset', id);
    },
  };
}

/**
 * The last theme used in each appearance, so the rail toggle returns to it
 * rather than to the built-in every time. Session-only on purpose: it is a
 * convenience, not a preference, and persisting it would mean a settings key
 * the user never set.
 */
const lastUsed: Record<Appearance, string | null> = { light: null, dark: null };

export function rememberThemeChoice(theme: CatalogueTheme) {
  lastUsed[theme.appearance] = theme.id;
}
