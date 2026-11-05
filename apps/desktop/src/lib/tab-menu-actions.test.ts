import { describe, expect, it, vi } from 'vitest';

import { tabMenuActions } from './tab-menu-actions';

const on = {
  newTabToRight: vi.fn(),
  closeToRight: vi.fn(),
  moveToNewWindow: vi.fn(),
  moveToWindow: vi.fn(),
  close: vi.fn(),
};

const ids = (groups: ReturnType<typeof tabMenuActions>) => groups.map((g) => g.map((a) => a.id));

describe('tabMenuActions', () => {
  it('offers new, close-to-the-right and close, in groups', () => {
    const groups = tabMenuActions({ tabsAfter: 2, canClose: true, multiWindow: false, siblings: [] }, on);
    expect(ids(groups)).toEqual([['new-tab-right', 'close-right'], ['close']]);
  });

  it('disables what can’t apply', () => {
    const [first, last] = tabMenuActions({ tabsAfter: 0, canClose: false, multiWindow: false, siblings: [] }, on);
    expect(first.find((a) => a.id === 'close-right')?.disabled).toBe(true);
    expect(last[0].disabled).toBe(true);
  });

  it('offers other windows where there are several', () => {
    const groups = tabMenuActions(
      { tabsAfter: 0, canClose: true, multiWindow: true, siblings: [{ label: 'w-1', name: 'Notes (main window)' }] },
      on,
    );
    expect(ids(groups)).toEqual([['new-tab-right', 'close-right'], ['new-window', 'move-to-window'], ['close']]);
    const move = groups[1][1];
    expect(move.items?.map((a) => a.label)).toEqual(['Notes (main window)']);
    move.items?.[0].onSelect?.();
    expect(on.moveToWindow).toHaveBeenCalledWith('w-1');
  });

  it('leaves Move to Window out when there’s no other window', () => {
    const groups = tabMenuActions({ tabsAfter: 0, canClose: true, multiWindow: true, siblings: [] }, on);
    expect(ids(groups)[1]).toEqual(['new-window']);
  });
});
