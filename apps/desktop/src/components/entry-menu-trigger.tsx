import { cloneElement, type ReactElement, type ReactNode } from 'react';

import { ContextMenu, ContextMenuTrigger } from '@sunstead/ui/components/context-menu';
import { useIsMobile } from '@sunstead/ui/hooks/use-mobile';
import type { EntryTarget } from '@/lib/entry-actions';
import { touchFirst } from '@/lib/backend/platform';
import { useHold } from '@/lib/hold';
import { useEntrySheet, type EntrySheetFrom } from '@/lib/stores/entry-sheet';

/**
 * What opens a file or folder's actions: its context menu (`menu`) on a
 * computer, and on a touch screen (or a phone-width window) a hold that
 * opens the hold sheet (`EntrySheet`), as Discord does, in place of a menu
 * at the finger.
 */
export function EntryMenuTrigger({
  entry,
  render,
  menu,
  from = 'list',
}: {
  entry: EntryTarget;
  from?: EntrySheetFrom;
  render: ReactElement<Record<string, unknown>>;
  /** The menu on a computer; without one, only a touch screen has actions here. */
  menu?: ReactNode;
}) {
  const phone = useIsMobile();
  const hold = useHold(() => useEntrySheet.getState().open(entry, from));
  if (phone || touchFirst) return cloneElement(render, hold);
  if (!menu) return render;
  return (
    <ContextMenu>
      <ContextMenuTrigger render={render} />
      {menu}
    </ContextMenu>
  );
}
