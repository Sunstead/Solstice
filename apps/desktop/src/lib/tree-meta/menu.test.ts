import { describe, expect, it, vi } from 'vitest';
import type { EntryMenuItem } from '@/lib/entry-menu-items';
import { FOLDER_COLORS } from './colors';
import { treeMetaMenuItems } from './menu';

const actions = { toggleBookmark: vi.fn(), setColor: vi.fn(), customColor: vi.fn() };
const labels = (items: EntryMenuItem[]) => items.map((i) => (i.kind === 'separator' ? '—' : i.label));
const colour = (items: EntryMenuItem[]) => {
  const sub = items.find((i) => i.kind === 'submenu');
  if (sub?.kind !== 'submenu') throw new Error('no Colour submenu');
  return sub.items;
};

describe('treeMetaMenuItems', () => {
  it('offers a bookmark either way round', () => {
    expect(labels(treeMetaMenuItems({ isDir: false, bookmarked: false, color: null }, actions))).toEqual(['Bookmark']);
    expect(labels(treeMetaMenuItems({ isDir: false, bookmarked: true, color: null }, actions))).toEqual([
      'Remove Bookmark',
    ]);
  });

  it('gives folders a Colour submenu: the presets, Custom and None', () => {
    const items = colour(treeMetaMenuItems({ isDir: true, bookmarked: false, color: null }, actions));
    expect(labels(items)).toEqual([...FOLDER_COLORS.map((c) => c.name), '—', 'Custom...', 'None']);
    const none = items[items.length - 1];
    expect(none?.kind === 'item' && none.disabled).toBe(true);
  });

  it('checks the colour in use, and Custom for one of its own', () => {
    const preset = FOLDER_COLORS[2].hex;
    const checked = (color: string) =>
      colour(treeMetaMenuItems({ isDir: true, bookmarked: false, color }, actions))
        .filter((i) => i.kind === 'item' && i.checked)
        .map((i) => (i.kind === 'item' ? i.label : ''));
    expect(checked(preset)).toEqual([FOLDER_COLORS[2].name]);
    expect(checked('#123456')).toEqual(['Custom...']);
  });

  it('runs what it says', () => {
    const items = colour(treeMetaMenuItems({ isDir: true, bookmarked: false, color: '#123456' }, actions));
    for (const item of items) if (item.kind === 'item') item.run();
    expect(actions.setColor).toHaveBeenCalledWith(FOLDER_COLORS[0].hex);
    expect(actions.setColor).toHaveBeenCalledWith(null);
    expect(actions.customColor).toHaveBeenCalled();
  });
});
