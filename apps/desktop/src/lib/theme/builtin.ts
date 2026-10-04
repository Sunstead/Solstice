import { DEFAULT_PAIR, THEMES } from '@sunstead/ui/themes';
import type { CatalogueTheme } from './types';

/**
 * The built-in themes are the shared Sunstead set, so Solstice, Atlas and
 * Cosmos offer the same ones. Their colours live in @sunstead/ui's CSS
 * (`[data-theme='<id>']`), not here: a built-in carries no variables, and
 * `applyTheme` puts its id on <html> instead.
 *
 * Solstice's own themes joined that set in @sunstead/ui 0.3.0; the ids that
 * merged into a Sunstead theme are mapped in `settings/migrations.ts`.
 */
export const builtinThemes: CatalogueTheme[] = THEMES.map((theme) => ({
  id: theme.id,
  name: theme.name,
  appearance: theme.scheme,
  style: theme.style,
  vars: {},
  source: 'builtin',
}));

/** The fallback whenever a configured theme id no longer resolves. */
export const DEFAULT_THEME_ID = DEFAULT_PAIR.dark;
export const DEFAULT_LIGHT_THEME_ID = DEFAULT_PAIR.light;
