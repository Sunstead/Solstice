import type { ThemeToken } from './tokens';

/**
 * A theme is data: a name and a set of shadcn variables. There is no CSS, no
 * selector and no code in one, which is what makes a user-authored theme safe
 * to drop into a workspace folder.
 *
 * Built-in themes are the exception: their colours are CSS in @sunstead/ui
 * and their `vars` are empty (see `builtin.ts`).
 */
export interface Theme {
  /** Stable and unique; user themes are prefixed `user:` when loaded. */
  id: string;
  name: string;
  /**
   * Which built-in the theme layers over (the default of that appearance),
   * and which class goes on `<html>`. Themes are partial, so a palette only
   * declares what it changes.
   */
  appearance: 'light' | 'dark';
  /** Built-ins only: `tech` themes are square, mono and bracketed. */
  style?: 'rounded' | 'tech';
  author?: string;
  vars: Partial<Record<ThemeToken, string>>;
}

/** Where a user theme was found, for the badge on its card. */
export type ThemeSource = 'builtin' | 'workspace' | 'global';

export interface CatalogueTheme extends Theme {
  source: ThemeSource;
  /** Absolute path, for user themes only — shown and revealable in the pane. */
  path?: string;
}
