import { describe, expect, it } from 'vitest';

import { findDate, formatDate, withDate } from './dates';

describe('findDate', () => {
  it('finds a plain date', () => {
    const found = findDate('due: 2026-10-25');
    expect(found?.parts).toEqual({ year: 2026, month: 10, day: 25 });
    expect(found?.before).toBe('due: ');
    expect(found?.value).toBe('2026-10-25');
  });

  it('finds a date with a time, quoted, with a comment', () => {
    const found = findDate(`created: "2026-01-02 09:05:30" # when`);
    expect(found?.parts).toEqual({ year: 2026, month: 1, day: 2, hour: 9, minute: 5 });
    expect(found?.separator).toBe(' ');
    expect(found?.seconds).toBe(true);
    expect(found?.after).toBe('" # when');
  });

  it('leaves what is not a date value alone', () => {
    expect(findDate('title: 2026-10-25 notes')).toBeNull();
    expect(findDate('- 2026-10-25')).toBeNull();
    expect(findDate('# due: 2026-10-25')).toBeNull();
    expect(findDate(`due: "2026-10-25'`)).toBeNull();
    expect(findDate('due: 2026-13-01')).toBeNull();
  });
});

describe('formatDate', () => {
  it('writes the time the way it was', () => {
    const parts = { year: 2026, month: 3, day: 4, hour: 7, minute: 8 };
    expect(formatDate(parts, { separator: 'T', seconds: false })).toBe('2026-03-04T07:08');
    expect(formatDate(parts, { separator: ' ', seconds: true })).toBe('2026-03-04 07:08:00');
    expect(formatDate({ year: 2026, month: 3, day: 4 }, { separator: 'T', seconds: false })).toBe('2026-03-04');
  });
});

describe('withDate', () => {
  it('changes only that line', () => {
    const block = `---\ntitle: Plan\ndue: '2026-10-25' # soon\n---`;
    expect(withDate(block, 2, { year: 2027, month: 1, day: 9 })).toBe(`---\ntitle: Plan\ndue: '2027-01-09' # soon\n---`);
    expect(withDate(block, 1, { year: 2027, month: 1, day: 9 })).toBe(block);
  });
});
