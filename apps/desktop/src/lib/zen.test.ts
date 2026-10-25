import { describe, expect, it } from 'vitest';
import { zenAllowed } from '@/lib/zen';

describe('zenAllowed', () => {
  it('is only for touch-first screens wider than a phone', () => {
    expect(zenAllowed({ touchFirst: true, isMobile: false })).toBe(true);
    expect(zenAllowed({ touchFirst: true, isMobile: true })).toBe(false);
    expect(zenAllowed({ touchFirst: false, isMobile: false })).toBe(false);
  });
});
