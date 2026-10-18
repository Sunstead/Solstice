import { describe, expect, it } from 'vitest';

import { clamp, dropIndex, lag, shifts, targetIndex } from './tab-reorder';

const centres = [50, 150, 250, 350];

describe('targetIndex', () => {
  it('stays put while the tab is still over its own slot', () => {
    expect(targetIndex(centres, 1, 150)).toBe(1);
    expect(targetIndex(centres, 1, 120)).toBe(1);
  });

  it('swaps once the dragged tab crosses a neighbour’s centre', () => {
    expect(targetIndex(centres, 1, 251)).toBe(2);
    expect(targetIndex(centres, 1, 249)).toBe(1);
    expect(targetIndex(centres, 2, 49)).toBe(0);
  });

  it('goes to either end', () => {
    expect(targetIndex(centres, 0, 900)).toBe(3);
    expect(targetIndex(centres, 3, -900)).toBe(0);
  });
});

describe('shifts', () => {
  it('moves the tabs passed by one slot toward where the dragged tab left', () => {
    expect(shifts(4, 0, 2, 100)).toEqual([0, -100, -100, 0]);
    expect(shifts(4, 3, 1, 100)).toEqual([0, 100, 100, 0]);
  });

  it('moves nothing when nothing is passed', () => {
    expect(shifts(4, 2, 2, 100)).toEqual([0, 0, 0, 0]);
  });
});

describe('dropIndex', () => {
  it('counts the strip as it is before the tab leaves it', () => {
    expect(dropIndex(0, 2)).toBe(3);
    expect(dropIndex(3, 1)).toBe(1);
    expect(dropIndex(2, 2)).toBe(2);
  });
});

describe('lag', () => {
  it('follows a quarter of the way and stops at the limit', () => {
    expect(lag(8)).toBe(2);
    expect(lag(-400)).toBe(-12);
    expect(clamp(5, 0, 3)).toBe(3);
  });
});
