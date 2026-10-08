import { themeById } from '@sunstead/ui/themes';
import { DEFAULT_LIGHT_THEME_ID, DEFAULT_THEME_ID } from './builtin';
import type { Theme } from './types';
import { THEME_TOKENS, isThemeToken } from './tokens';

const STORAGE_KEY = 'solstice.theme.lastApplied';

/** What `index.html` reads to paint the first frame. */
export interface FirstPaint {
  /** The built-in on `<html data-theme>`. */
  theme: string;
  style: 'rounded' | 'tech';
  appearance: 'light' | 'dark';
  /** A user theme's own variables, layered over `theme`. */
  vars: [string, string][];
}

/**
 * Puts a theme on `<html>`.
 *
 * A built-in is CSS in @sunstead/ui, so it is just its id in `data-theme`
 * (plus `data-style`, which tech themes use). A user theme sits on the
 * built-in default of its appearance and adds its variables as inline custom
 * properties, which beat the `[data-theme]` block. Settings own the
 * `--editor-*` properties on the same element, and the two never collide.
 * Everything downstream (flexlayout, typeset, the CodeMirror theme) reads
 * these through `var()`, so nothing else has to be told a theme changed.
 *
 * `color-scheme` is left alone, as it always was: setting it would restyle
 * native controls.
 */
export function applyTheme(theme: Theme) {
  const root = document.documentElement;
  const builtin =
    themeById(theme.id)
    ?? themeById(theme.appearance === 'light' ? DEFAULT_LIGHT_THEME_ID : DEFAULT_THEME_ID)!;

  root.dataset.theme = builtin.id;
  root.dataset.style = builtin.style;
  root.classList.remove('light', 'dark');
  root.classList.add(theme.appearance);

  const vars = inlineVars(theme);
  const keep = new Set(vars.map(([name]) => name));
  // Clears every theme variable the new theme doesn't set, not only the ones
  // this session wrote: the first-paint script may have stamped others.
  for (const name of [...THEME_TOKENS, '--border']) {
    if (!keep.has(name)) root.style.removeProperty(name);
  }
  for (const [name, value] of vars) root.style.setProperty(name, value);

  syncThemeColor();

  rememberForFirstPaint({
    theme: builtin.id,
    style: builtin.style,
    appearance: theme.appearance,
    vars,
  });
}

/**
 * The browser's own chrome (Safari's bars, a home-screen app's status bar)
 * takes the sidebar's colour, the colour of the app's top edge.
 */
function syncThemeColor() {
  let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (!meta) {
    meta = document.createElement('meta');
    meta.name = 'theme-color';
    document.head.append(meta);
  }
  const probe = document.createElement('div');
  probe.style.cssText = 'position:absolute;visibility:hidden;background:var(--sidebar)';
  document.body.append(probe);
  meta.content = getComputedStyle(probe).backgroundColor;
  probe.remove();
}

/**
 * A user theme's variables, plus `--border` when it sets the border's colour
 * or opacity: the built-ins give `--border` as a finished colour, so it has
 * to be derived again from whichever half the theme changed.
 */
function inlineVars(theme: Theme): [string, string][] {
  const vars = Object.entries(theme.vars).filter(
    (entry): entry is [string, string] => isThemeToken(entry[0]) && typeof entry[1] === 'string',
  );
  if (vars.some(([name]) => name === '--border-color' || name === '--border-opacity')) {
    vars.push(['--border', 'oklch(from var(--border-color) l c h / var(--border-opacity))']);
  }
  return vars;
}

/**
 * Mirrors the active theme so the inline script in `index.html` can paint it
 * before the first frame. The settings store loads asynchronously, so without
 * this the first frame is drawn in the default theme and flashes.
 */
function rememberForFirstPaint(paint: FirstPaint) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(paint));
  } catch {
    // Private mode, or storage disabled. Costs a flash, nothing more.
  }
}
