import { describe, expect, it } from 'vitest';
import {
  WORKSPACE_SWATCHES,
  contrastRatio,
  defaultWorkspaceColor,
  normalizeHex,
  randomWorkspaceColor,
  textColorFor,
} from './color';

// The same cases as `normalize_hex` in crates/solstice-core/src/color.rs.
describe('normalizeHex', () => {
  it('accepts short and long hex in any case', () => {
    expect(normalizeHex('#4F7CC4')).toBe('#4f7cc4');
    expect(normalizeHex('  #abc ')).toBe('#aabbcc');
    expect(normalizeHex('#FFF')).toBe('#ffffff');
  });

  it('rejects everything else', () => {
    for (const bad of ['', '#', '4f7cc4', '#fffff', '#ggg', '#12345678', 'red', '#ab c']) {
      expect(normalizeHex(bad), bad).toBeNull();
    }
  });
});

const names = Array.from({ length: 1000 }, (_, i) => `Workspace ${i} ${i.toString(36)}`);

describe('defaultWorkspaceColor', () => {
  it('is the same for the same name, and varies between names', () => {
    expect(defaultWorkspaceColor('School')).toBe(defaultWorkspaceColor('School'));
    expect(new Set(names.map(defaultWorkspaceColor)).size).toBeGreaterThan(200);
  });

  it('is always a hex color the letters read on', () => {
    for (const name of names) {
      const color = defaultWorkspaceColor(name);
      expect(normalizeHex(color)).toBe(color);
      expect(contrastRatio(color, textColorFor(color)), `${name}: ${color}`).toBeGreaterThanOrEqual(3);
    }
  });

  it('is neither washed out nor glaring', () => {
    for (const name of names) {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(defaultWorkspaceColor(name).slice(i, i + 2), 16));
      const spread = Math.max(r, g, b) - Math.min(r, g, b);
      expect(spread, name).toBeGreaterThan(30);
      expect(Math.max(r, g, b), name).toBeLessThan(250);
      expect(Math.max(r, g, b), name).toBeGreaterThan(90);
    }
  });
});

describe('randomWorkspaceColor and swatches', () => {
  it('come from the same readable band', () => {
    for (const color of [...WORKSPACE_SWATCHES, ...Array.from({ length: 200 }, () => randomWorkspaceColor())]) {
      expect(normalizeHex(color)).toBe(color);
      expect(contrastRatio(color, textColorFor(color)), color).toBeGreaterThanOrEqual(3);
    }
    expect(WORKSPACE_SWATCHES).toHaveLength(12);
  });
});

describe('textColorFor', () => {
  it('puts dark letters on light colors and light ones on dark', () => {
    expect(textColorFor('#ffffff')).not.toBe(textColorFor('#000000'));
    expect(contrastRatio('#ffffff', textColorFor('#ffffff'))).toBeGreaterThan(10);
    expect(contrastRatio('#000000', textColorFor('#000000'))).toBeGreaterThan(10);
  });
});
