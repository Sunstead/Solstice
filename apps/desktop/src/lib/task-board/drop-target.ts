import { targetIndex } from '@/lib/tab-reorder';
import type { CardRef } from './parse';

/** Where a dragged card or column lands, from what's on screen, apart from the DOM. */

export interface Box {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface ColumnLayout {
  box: Box;
  cards: Box[];
}

/** The column under `x`, or the nearest one beside it. */
function columnAt(columns: ColumnLayout[], x: number): number {
  let best = -1;
  let distance = Infinity;
  columns.forEach(({ box }, i) => {
    const d = x < box.left ? box.left - x : x > box.right ? x - box.right : 0;
    if (d < distance) {
      best = i;
      distance = d;
    }
  });
  return best;
}

/**
 * Where a card dragged to `point` lands: its column and its index there once
 * moved, before the first other card whose middle is below the point.
 */
export function cardTarget(columns: ColumnLayout[], point: { x: number; y: number }, from: CardRef): CardRef | null {
  const column = columnAt(columns, point.x);
  if (column === -1) return null;
  let card = 0;
  columns[column].cards.forEach((box, i) => {
    if (column === from.column && i === from.card) return;
    if ((box.top + box.bottom) / 2 < point.y) card++;
  });
  return { column, card };
}

/** Where a column dragged to `x` lands: its index once moved. */
export function columnTarget(columns: ColumnLayout[], from: number, x: number): number {
  return targetIndex(
    columns.map(({ box }) => (box.left + box.right) / 2),
    from,
    x,
  );
}
