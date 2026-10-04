import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { THEMES } from '@sunstead/ui/themes';
import { builtinThemes, DEFAULT_LIGHT_THEME_ID, DEFAULT_THEME_ID } from './builtin';

const html = readFileSync(path.resolve(__dirname, '../../../index.html'), 'utf8');

describe('built-in themes', () => {
  it('index.html paints the same themes before any script', () => {
    const block = /var themes = \{([^}]*)\}/.exec(html)?.[1] ?? '';
    const painted = [...block.matchAll(/'?([\w-]+)'?: '(\w+) (\w+)'/g)].map((m) => [m[1], `${m[2]} ${m[3]}`]);
    expect(painted).toEqual(THEMES.map((t) => [t.id, `${t.scheme} ${t.style}`]));
    expect(html).toContain("localStorage.getItem('solstice.theme.lastApplied')");
    expect(html).toContain(`data-theme="${DEFAULT_THEME_ID}"`);
  });

  it('are the shared Sunstead set, with defaults for both appearances', () => {
    expect(builtinThemes.map((t) => t.id)).toEqual(THEMES.map((t) => t.id));
    expect(builtinThemes.every((t) => t.source === 'builtin' && Object.keys(t.vars).length === 0)).toBe(true);
    expect(builtinThemes.find((t) => t.id === DEFAULT_THEME_ID)?.appearance).toBe('dark');
    expect(builtinThemes.find((t) => t.id === DEFAULT_LIGHT_THEME_ID)?.appearance).toBe('light');
  });
});
