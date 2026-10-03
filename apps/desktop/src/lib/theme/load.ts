import type { UserThemeFile } from '@/bindings';
import { isThemeToken } from './tokens';
import type { CatalogueTheme, ThemeSource } from './types';

export interface ThemeLoadIssue {
  path: string;
  reason: string;
}

export interface LoadedThemes {
  themes: CatalogueTheme[];
  issues: ThemeLoadIssue[];
}

function basename(path: string) {
  return path.split(/[\\/]/).pop() ?? path;
}

/** A filename-derived id, for a theme file that did not declare one. */
function idFromPath(path: string) {
  return basename(path)
    .replace(/\.json$/i, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Turns one file's contents into a theme, or explains why it could not.
 *
 * Everything here is defensive: these files are written by hand, and a typo in
 * one of them must not take the settings pane down with it. Keys outside the
 * token allowlist are dropped rather than rejected -- a theme written against
 * a newer build should still apply the parts this build understands.
 */
function parseTheme(
  file: UserThemeFile,
): { theme: CatalogueTheme } | { issue: ThemeLoadIssue } {
  const fail = (reason: string) => ({ issue: { path: file.path, reason } });

  let raw: unknown;
  try {
    raw = JSON.parse(file.contents);
  } catch (error) {
    return fail(error instanceof Error ? error.message : 'Not valid JSON');
  }

  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return fail('Expected a JSON object');
  }

  const source = raw as Record<string, unknown>;
  const appearance = source.appearance;
  if (appearance !== 'light' && appearance !== 'dark') {
    return fail('"appearance" must be "light" or "dark"');
  }
  if (typeof source.vars !== 'object' || source.vars === null) {
    return fail('"vars" must be an object of CSS variables');
  }

  const vars: CatalogueTheme['vars'] = {};
  const rejected: string[] = [];
  for (const [name, value] of Object.entries(source.vars)) {
    if (typeof value !== 'string') continue;
    if (isThemeToken(name)) vars[name] = value;
    else rejected.push(name);
  }
  if (rejected.length) {
    console.warn(
      `Theme "${basename(file.path)}" declares variables that are not part of `
        + `the theme token set and were ignored: ${rejected.join(', ')}`,
    );
  }

  const declaredId = typeof source.id === 'string' ? source.id.trim() : '';
  const id = declaredId || idFromPath(file.path);
  if (!id) return fail('Could not derive an id from the filename');

  return {
    theme: {
      // Prefixed so a user theme can never shadow -- or be shadowed by -- a
      // built-in that happens to share its name.
      id: `user:${id}`,
      name: typeof source.name === 'string' && source.name ? source.name : id,
      appearance,
      author: typeof source.author === 'string' ? source.author : undefined,
      vars,
      source: file.source as ThemeSource,
      path: file.path,
    },
  };
}

export function loadUserThemes(files: UserThemeFile[]): LoadedThemes {
  const themes: CatalogueTheme[] = [];
  const issues: ThemeLoadIssue[] = [];
  const seen = new Set<string>();

  for (const file of files) {
    const result = parseTheme(file);
    if ('issue' in result) {
      issues.push(result.issue);
      continue;
    }
    // A workspace theme is listed after the global ones, so it wins a clash --
    // the more specific location overriding the shared one, as settings do.
    if (seen.has(result.theme.id)) {
      const index = themes.findIndex((t) => t.id === result.theme.id);
      themes[index] = result.theme;
      continue;
    }
    seen.add(result.theme.id);
    themes.push(result.theme);
  }

  return { themes, issues };
}
