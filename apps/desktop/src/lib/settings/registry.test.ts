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
