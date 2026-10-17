import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/backend/platform', () => ({ touchFirst: false, can: {}, shell: 'web' }));

const { settingsRegistry } = await import('./registry');

describe('appearance.islands', () => {
  it('is on unless turned off, and marks <html> for the stylesheets', () => {
    const islands = settingsRegistry['appearance.islands'];
    expect(islands.default).toBe(true);
    expect(islands.scope).toBe('global');
    expect(islands.section).toBe('appearance');
    expect(islands.domAttr?.name).toBe('data-islands');
    expect(islands.domAttr?.format?.(true)).toBe('true');
    expect(islands.domAttr?.format?.(false)).toBe('false');
  });
});

describe('appearance.islandBorders', () => {
  it('is off by default, marks <html>, and sits with Islands', () => {
    const borders = settingsRegistry['appearance.islandBorders'];
    expect(borders.default).toBe(false);
    expect(borders.group).toBe(settingsRegistry['appearance.islands'].group);
    expect(borders.domAttr?.name).toBe('data-island-borders');
    expect(borders.domAttr?.format?.(true)).toBe('true');
  });

  it('is disabled, not hidden, while Islands is off', () => {
    const borders = settingsRegistry['appearance.islandBorders'];
    expect(borders.disabledWhen?.((k) => k === 'appearance.islands')).toBe(false);
    expect(borders.disabledWhen?.(() => false)).toBe(true);
    expect(borders.visibleWhen).toBeUndefined();
  });
});
