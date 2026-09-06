import type { CatalogueTheme } from '../types';
import { solstice_light } from './solstice-light';
import { solstice_dark } from './solstice-dark';
import { solstice_paper } from './solstice-paper';
import { solstice_midnight } from './solstice-midnight';
import { glacier } from './glacier';
import { orchard } from './orchard';
import { ember } from './ember';
import { verdigris } from './verdigris';
import { brutalist } from './brutalist';
import { bubblegum } from './bubblegum';
import { blueprint } from './blueprint';
import { inferno } from './inferno';
import { stone } from './stone';

/**
 * The two neutrals first, then the coloured pairs, then the shape-led "fun"
 * set that leans on --radius and border contrast rather than just hue. Every
 * one of these is the app's own palette rather than a port: a theme is a
 * handful of variables, so shipping originals costs no more than shipping
 * someone else's and keeps the default set looking like one family.
 */
export const builtinThemes: CatalogueTheme[] = [
  solstice_light,
  solstice_dark,
  stone,
  solstice_paper,
  solstice_midnight,
  glacier,
  ember,
  orchard,
  verdigris,
  brutalist,
  bubblegum,
  blueprint,
  inferno,
].map((theme) => ({ ...theme, source: 'builtin' }));

/** The fallback whenever a configured theme id no longer resolves. */
export const DEFAULT_THEME_ID = solstice_dark.id;
export const DEFAULT_LIGHT_THEME_ID = solstice_light.id;
