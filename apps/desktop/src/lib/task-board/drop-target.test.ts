import { describe, expect, it } from 'vitest';

import { cardTarget, columnTarget, type ColumnLayout } from './drop-target';

// Three columns 200 wide with 20 between; cards 50 tall from y=100.
const column = (i: number, cards: number): ColumnLayout => ({
  box: { left: i * 220, right: i * 220 + 200, top: 50, bottom: 600 },
  cards: Array.from({ length: cards }, (_, c) => ({ left: i * 220, right: i * 220 + 200, top: 100 + c * 60, bottom: 150 + c * 60 })),
});
const LAYOUT = [column(0, 3), column(1, 0), column(2, 2)];

describe('cardTarget', () => {
  it('lands before the first card whose middle is below the point', () => {
    expect(cardTarget(LAYOUT, { x: 500, y: 90 }, { column: 0, card: 0 })).toEqual({ column: 2, card: 0 });
    expect(cardTarget(LAYOUT, { x: 500, y: 140 }, { column: 0, card: 0 })).toEqual({ column: 2, card: 1 });
    expect(cardTarget(LAYOUT, { x: 500, y: 500 }, { column: 0, card: 0 })).toEqual({ column: 2, card: 2 });
  });

  it('lands at the top of an empty column', () => {
    expect(cardTarget(LAYOUT, { x: 300, y: 400 }, { column: 0, card: 0 })).toEqual({ column: 1, card: 0 });
  });

  it('counts its own column without the dragged card', () => {
    // Dragging the first card below the second: it ends up at index 1.
    expect(cardTarget(LAYOUT, { x: 100, y: 200 }, { column: 0, card: 0 })).toEqual({ column: 0, card: 1 });
    expect(cardTarget(LAYOUT, { x: 100, y: 110 }, { column: 0, card: 0 })).toEqual({ column: 0, card: 0 });
    expect(cardTarget(LAYOUT, { x: 100, y: 500 }, { column: 0, card: 1 })).toEqual({ column: 0, card: 2 });
  });

  it('takes the nearest column for a point in a gap or past the ends', () => {
    expect(cardTarget(LAYOUT, { x: 205, y: 90 }, { column: 2, card: 0 })).toEqual({ column: 0, card: 0 });
    expect(cardTarget(LAYOUT, { x: 900, y: 90 }, { column: 0, card: 0 })).toEqual({ column: 2, card: 0 });
    expect(cardTarget([], { x: 0, y: 0 }, { column: 0, card: 0 })).toBeNull();
  });
});

describe('columnTarget', () => {
  it('counts the columns whose middles the point is past', () => {
    expect(columnTarget(LAYOUT, 0, 350)).toBe(1);
    expect(columnTarget(LAYOUT, 0, 600)).toBe(2);
    expect(columnTarget(LAYOUT, 2, 10)).toBe(0);
    expect(columnTarget(LAYOUT, 1, 300)).toBe(1);
  });
});
