import type { Theme } from './types';
import { isThemeToken } from './tokens';

const STORAGE_KEY = 'solstice.theme.lastApplied';

/**
 * Variables the last `applyTheme` wrote. A theme is partial, so switching from
 * a palette that sets `--syntax-*` to one that does not has to *remove* those
 * properties — leaving them would blend the two themes.
 */
let applied: string[] = [];

/**
 * Writes a theme onto `<html>` as inline custom properties.
 *
 * Inline styles are the same mechanism `settings/apply.ts` uses, so precedence
 * over the `:root` / `.dark` blocks is correct and the two never collide: a
 * theme owns the shadcn tokens, settings own `--editor-*`. Everything
 * downstream (flexlayout, typeset, the CodeMirror theme) reads these through
 * `var()`, so nothing else has to be told a theme changed.
 */
export function applyTheme(theme: Theme) {
  const root = document.documentElement;

  root.classList.remove('light', 'dark');
  root.classList.add(theme.appearance);

  const next = Object.entries(theme.vars).filter(([name]) => isThemeToken(name));
  const keep = new Set(next.map(([name]) => name));

  for (const name of applied) {
    if (!keep.has(name)) root.style.removeProperty(name);
  }
  for (const [name, value] of next) root.style.setProperty(name, value);
  applied = [...keep];

  rememberForFirstPaint(theme, next);
}

/**
 * Mirrors the active theme so the inline script in `index.html` can stamp it
 * before the first paint. The settings store loads asynchronously, so without
 * this the first frame is drawn in whatever `:root` says and flashes.
 */
function rememberForFirstPaint(theme: Theme, vars: [string, string][]) {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ appearance: theme.appearance, vars }),
    );
  } catch {
    // Private mode, or storage disabled. Costs a flash, nothing more.
  }
}
