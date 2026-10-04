import { describe, expect, it } from 'vitest';
import { THEMES } from '@sunstead/ui/themes';
import { migrateGlobal, migrateThemeIds, RETIRED_THEME_IDS } from '@/lib/settings/migrations';

describe('migrateThemeIds', () => {
  it('maps the merged Solstice themes once, and leaves the kept ones', () => {
    const patch = migrateThemeIds({
      'theme.preset': 'blueprint',
      'theme.lightPreset': 'glacier',
      'theme.darkPreset': 'stone',
    });
    expect(patch.set).toEqual({
      'theme.ids': 'sunstead',
      'theme.preset': 'hologram',
      'theme.lightPreset': 'lunar',
    });
    expect(patch.remove).toEqual([]);
  });

  it('does nothing after the first time, so the new Blueprint stays Blueprint', () => {
    const patch = migrateThemeIds({ 'theme.ids': 'sunstead', 'theme.preset': 'blueprint' });
    expect(patch.set).toEqual({});
  });

  it('maps every retired id to a theme of the same appearance that exists', () => {
    const dark = new Set(['solstice-dark', 'blueprint', 'solstice-midnight', 'verdigris', 'amethyst']);
    for (const [from, to] of Object.entries(RETIRED_THEME_IDS)) {
      const theme = THEMES.find((t) => t.id === to);
      expect(theme, to).toBeDefined();
      expect(theme!.scheme, from).toBe(dark.has(from) ? 'dark' : 'light');
    }
  });

  it('turns the oldest light/dark setting into the Sunstead pair', () => {
    expect(migrateGlobal({ 'appearance.theme': 'light' }).set).toEqual({ 'theme.preset': 'sunstead-light' });
  });
});
