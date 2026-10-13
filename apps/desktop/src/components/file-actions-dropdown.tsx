import { MoreVertical } from 'lucide-react';

import { targetFromPath } from '@/lib/entry-actions';
import { touchFirst } from '@/lib/backend/platform';
import { Button } from '@sunstead/ui/components/button';
import { useEntryMenuItems, type EntryMenuSurface } from '@/lib/entry-menu-items';
import { EntryMenuItems } from './entry-menu-items';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@sunstead/ui/components/dropdown-menu';

const components = {
  Item: DropdownMenuItem,
  Separator: DropdownMenuSeparator,
  Sub: DropdownMenuSub,
  SubTrigger: DropdownMenuSubTrigger,
  SubContent: DropdownMenuSubContent,
};

/**
 * Actions for the file the editor has open. The items themselves come from
 * `useEntryMenuItems`, the same source the explorer's context menu renders,
 * so the two can never offer different things for the same file.
 */
export function FileActionsDropdown({
  path,
  surface = 'editor',
}: {
  path: string;
  surface?: EntryMenuSurface;
}) {
  const items = useEntryMenuItems(targetFromPath(path), { surface });

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant='ghost' size='icon-sm'>
            <MoreVertical />
          </Button>
        }
      />
      {/* On a touch screen, focus stays where an item put it: handed back to
          the trigger, it would take the keyboard from a naming dialog. */}
      <DropdownMenuContent className='w-max min-w-52' finalFocus={touchFirst ? false : undefined}>
        <EntryMenuItems items={items} components={components} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
