import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/settings/store', () => ({ useSetting: () => false }));

import { paperColor } from './paper-color';

describe('paperColor', () => {
  it('swaps black and white on dark paper', () => {
    expect(paperColor('#000000', true)).toBe('#ffffff');
    expect(paperColor('#FFFFFF', true)).toBe('#000000');
  });

  it('keeps every other color, and all of them on light paper', () => {
    expect(paperColor('#0a84ff', true)).toBe('#0a84ff');
    expect(paperColor('#000000', false)).toBe('#000000');
    expect(paperColor('#ffffff', false)).toBe('#ffffff');
  });
});
