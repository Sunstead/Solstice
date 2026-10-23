import { createElement, type ComponentType } from 'react';
import { Ban, Bookmark, BookmarkX, Palette, Pipette } from 'lucide-react';

import type { EntryMenuItem } from '@/lib/entry-menu-items';
import { cn } from '@/lib/utils';
import { FOLDER_COLORS } from './colors';

/** A round swatch in a menu, where icons go. */
function swatch(hex: string): ComponentType<{ className?: string }> {
  return ({ className }) =>
    createElement('span', {
      className: cn('inline-block size-3.5 shrink-0 rounded-full', className),
      style: { backgroundColor: hex },
    });
}

const SWATCH_ICONS = new Map(FOLDER_COLORS.map((c) => [c.hex, swatch(c.hex)]));

/** The entry menu's bookmark item, and a folder's Color submenu. */
export function treeMetaMenuItems(
  { isDir, bookmarked, color }: { isDir: boolean; bookmarked: boolean; color: string | null },
  actions: { toggleBookmark: () => void; setColor: (color: string | null) => void; customColor: () => void },
): EntryMenuItem[] {
  const items: EntryMenuItem[] = [
    {
      kind: 'item',
      id: 'bookmark',
      label: bookmarked ? 'Remove Bookmark' : 'Bookmark',
      icon: bookmarked ? BookmarkX : Bookmark,
      run: actions.toggleBookmark,
    },
  ];
  if (!isDir) return items;
  const preset = FOLDER_COLORS.some((c) => c.hex === color);
  items.push({
    kind: 'submenu',
    id: 'folder-color',
    label: 'Color',
    icon: Palette,
    items: [
      ...FOLDER_COLORS.map(
        (c): EntryMenuItem => ({
          kind: 'item',
          id: `folder-color-${c.name.toLowerCase()}`,
          label: c.name,
          icon: SWATCH_ICONS.get(c.hex)!,
          checked: c.hex === color,
          run: () => actions.setColor(c.hex),
        }),
      ),
      { kind: 'separator', id: 'folder-color-presets' },
      {
        kind: 'item',
        id: 'folder-color-custom',
        label: 'Custom...',
        icon: Pipette,
        checked: color !== null && !preset,
        run: actions.customColor,
      },
      {
        kind: 'item',
        id: 'folder-color-none',
        label: 'None',
        icon: Ban,
        disabled: color === null,
        run: () => actions.setColor(null),
      },
    ],
  });
  return items;
}
