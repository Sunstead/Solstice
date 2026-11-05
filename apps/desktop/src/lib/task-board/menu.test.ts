import { describe, expect, it, vi } from 'vitest';

import { cardMenuActions, columnMenuActions } from './menu';

const ids = (groups: { id: string }[][]) => groups.map((g) => g.map((a) => a.id));

describe('board menus', () => {
  it('gives a card Edit, Add Sub-task, Copy, then Delete; no ticking', () => {
    const edit = vi.fn();
    const groups = cardMenuActions({ edit, addSubtask: vi.fn(), copy: vi.fn(), remove: vi.fn() });
    expect(ids(groups)).toEqual([['edit', 'add-subtask', 'copy'], ['delete']]);
    expect(groups[1][0].destructive).toBe(true);
    groups[0][0].onSelect?.();
    expect(edit).toHaveBeenCalled();
  });

  it('gives a column Add Card, Rename, its colours, then Delete', () => {
    const groups = columnMenuActions({ addCard: vi.fn(), rename: vi.fn(), colors: 'swatches', remove: vi.fn() });
    expect(ids(groups)).toEqual([['add-card', 'rename'], ['color'], ['delete']]);
    expect(groups[1][0].content).toBe('swatches');
  });
});
