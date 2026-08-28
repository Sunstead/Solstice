import { useEffect } from 'react';
import { getSetting, setSetting, useSetting } from '@/lib/settings/store';
import type { SettingValue } from '@/lib/settings/registry';

export type Theme = SettingValue<'appearance.theme'>;

/**
 * Keeps the `light`/`dark` class on the document root in sync with
 * `appearance.theme`. Under `system` it keeps tracking the OS rather than
 * sampling the preference once.
 */
export function useThemeEffect() {
  const theme = useSetting('appearance.theme');

  useEffect(() => {
    const root = window.document.documentElement;

    const apply = (resolved: 'light' | 'dark') => {
      root.classList.remove('light', 'dark');
      root.classList.add(resolved);
    };

    if (theme !== 'system') {
      apply(theme);
      return;
    }

    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const sync = () => apply(query.matches ? 'dark' : 'light');

    sync();
    query.addEventListener('change', sync);
    return () => query.removeEventListener('change', sync);
  }, [theme]);
}

export function useTheme() {
  const theme = useSetting('appearance.theme');
  return { theme, setTheme: (next: Theme) => setSetting('appearance.theme', next) };
}

/** The concrete theme in effect right now, resolving `system`. */
export function resolvedTheme(): 'light' | 'dark' {
  const theme = getSetting('appearance.theme');
  if (theme !== 'system') return theme;
  return window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light';
}
