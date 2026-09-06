/**
 * The complete set of variables a theme is allowed to declare.
 *
 * This list is the enforcement point for the rule that a theme is a palette and
 * nothing else: anything a theme file declares that is not here is dropped. It
 * mirrors the `:root` block in `styles/app.css` exactly — when a token is added
 * there, add it here or themes will not be able to reach it.
 *
 * Deliberately absent are the two derived variables, `--border` and
 * `--color-tab-outline`: they are computed from `--border-color` /
 * `--border-opacity`, and letting a theme set them directly would break the
 * derivation rather than participate in it.
 */
export const THEME_TOKENS = [
  '--background',
  '--foreground',
  '--card',
  '--card-foreground',
  '--popover',
  '--popover-foreground',
  '--primary',
  '--primary-foreground',
  '--secondary',
  '--secondary-foreground',
  '--muted',
  '--muted-foreground',
  '--accent',
  '--accent-foreground',
  '--destructive',
  '--warning',

  '--border-color',
  '--border-opacity',
  '--input',
  '--ring',
  '--radius',

  '--chart-1',
  '--chart-2',
  '--chart-3',
  '--chart-4',
  '--chart-5',

  '--sidebar',
  '--sidebar-foreground',
  '--sidebar-primary',
  '--sidebar-primary-foreground',
  '--sidebar-accent',
  '--sidebar-accent-foreground',
  '--sidebar-border',
  '--sidebar-ring',

  '--syntax-keyword',
  '--syntax-string',
  '--syntax-number',
  '--syntax-function',
  '--syntax-type',
  '--syntax-property',
  '--syntax-constant',
  '--syntax-tag',

  '--canvas-color-1',
  '--canvas-color-2',
  '--canvas-color-3',
  '--canvas-color-4',
  '--canvas-color-5',
  '--canvas-color-6',
] as const;

export type ThemeToken = (typeof THEME_TOKENS)[number];

const tokenSet = new Set<string>(THEME_TOKENS);

export function isThemeToken(name: string): name is ThemeToken {
  return tokenSet.has(name);
}

/** The swatches a theme card previews, in the order they read best. */
export const SWATCH_TOKENS = [
  '--background',
  '--card',
  '--primary',
  '--accent',
  '--muted-foreground',
  '--border-color',
] as const satisfies readonly ThemeToken[];
