import { describe, expect, it } from 'vitest';
import { initials } from '@/lib/initials';

describe('initials', () => {
  it('takes the first and last word', () => {
    expect(initials('preston')).toBe('P');
    expect(initials('preston.b')).toBe('PB');
    expect(initials('pat_q_doe')).toBe('PD');
    expect(initials('Pat Doe')).toBe('PD');
  });

  it('ignores an email domain and copes with nothing', () => {
    expect(initials('pat@example.com')).toBe('P');
    expect(initials('  ')).toBe('?');
    expect(initials('élodie-ñ')).toBe('ÉÑ');
  });
});
