import { describe, expect, it } from 'vitest';

import { gridTarget, identity, movePage, removePages } from './pages';

describe('page order', () => {
  it('starts with every page where it is', () => {
    expect(identity(4)).toEqual([0, 1, 2, 3]);
  });

  it('moves a page, the others closing up behind it', () => {
    expect(movePage([0, 1, 2, 3], 0, 2)).toEqual([1, 2, 0, 3]);
    expect(movePage([0, 1, 2, 3], 3, 0)).toEqual([3, 0, 1, 2]);
    expect(movePage([0, 1, 2, 3], 1, 1)).toEqual([0, 1, 2, 3]);
  });

  it('ignores a move from or to nowhere', () => {
    const order = [0, 1, 2];
    expect(movePage(order, 5, 0)).toBe(order);
    expect(movePage(order, 0, -1)).toBe(order);
  });

  it('removes pages by their place, keeping the rest in order', () => {
    expect(removePages([3, 1, 0, 2], [1, 3])).toEqual([3, 0]);
  });

  it('never removes the last page', () => {
    const order = [0, 1];
    expect(removePages(order, [0, 1])).toBe(order);
  });
});

describe('gridTarget', () => {
  // Three across, two down, 100 apart.
  const centres = [
    { x: 50, y: 50 },
    { x: 150, y: 50 },
    { x: 250, y: 50 },
    { x: 50, y: 150 },
    { x: 150, y: 150 },
  ];

  it('is the slot whose centre is nearest', () => {
    expect(gridTarget(centres, { x: 140, y: 60 })).toBe(1);
    expect(gridTarget(centres, { x: 60, y: 160 })).toBe(3);
  });

  it('clamps to the ends past the grid', () => {
    expect(gridTarget(centres, { x: -500, y: -500 })).toBe(0);
    expect(gridTarget(centres, { x: 900, y: 900 })).toBe(4);
  });

  it('has no slot in an empty grid', () => {
    expect(gridTarget([], { x: 0, y: 0 })).toBe(-1);
  });
});
