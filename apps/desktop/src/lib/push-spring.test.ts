import { describe, expect, it } from 'vitest';
import { cssTimeMs } from '@/lib/push-spring';

describe('cssTimeMs', () => {
  it('reads milliseconds and seconds, as dev and production write them', () => {
    expect(cssTimeMs('385ms')).toBe(385);
    expect(cssTimeMs(' .385s')).toBe(385);
    expect(cssTimeMs('0.64s')).toBe(640);
  });
});
