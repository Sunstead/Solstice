import { describe, expect, it } from 'vitest';

import { EMPTY_HISTORY, pushHistory, redo, undo } from './history';

describe('board history', () => {
  it('steps back and forward through texts', () => {
    let history = pushHistory(EMPTY_HISTORY, 'a');
    history = pushHistory(history, 'b');
    // Now showing 'c'.
    const back = undo(history, 'c');
    expect(back?.text).toBe('b');
    const again = undo(back!.history, 'b');
    expect(again?.text).toBe('a');
    expect(undo(again!.history, 'a')).toBeNull();
    const forward = redo(again!.history, 'a');
    expect(forward?.text).toBe('b');
  });

  it('drops the redo branch on a new edit', () => {
    const history = pushHistory(EMPTY_HISTORY, 'a');
    const back = undo(history, 'b')!;
    const edited = pushHistory(back.history, 'a');
    expect(redo(edited, 'x')).toBeNull();
  });

  it('keeps at most 100 steps', () => {
    let history = EMPTY_HISTORY;
    for (let i = 0; i < 150; i++) history = pushHistory(history, String(i));
    expect(history.past).toHaveLength(100);
    expect(history.past[0]).toBe('50');
  });
});
