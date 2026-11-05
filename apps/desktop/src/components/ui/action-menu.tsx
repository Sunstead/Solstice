import { Fragment } from 'react';

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
import { useSheetMenus } from '@/hooks/use-sheet-menus';
import type { Action } from '@/lib/menu-actions';

import { ActionSheet } from './action-sheet';

export interface ActionMenuRequest {
  title: string;
  groups: Action[][];
  /** Where a dropdown opens: the pointer. */
  x: number;
  y: number;
  /** A dropdown's modality (a sheet always is); by default, modal. */
  modal?: boolean;
}

function DropdownItem({ action }: { action: Action }) {
  const Icon = action.icon;
  if (action.content) return <>{action.content}</>;
  if (action.items) {
    return (
      <DropdownMenuSub>
        <DropdownMenuSubTrigger disabled={action.disabled}>
          {Icon && <Icon />}
          {action.label}
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent>
          {action.items.map((item) => (
            <DropdownItem key={item.id} action={item} />
          ))}
        </DropdownMenuSubContent>
      </DropdownMenuSub>
    );
  }
  return (
    <DropdownMenuItem
      disabled={action.disabled}
      variant={action.destructive ? 'destructive' : undefined}
      onClick={action.onSelect}
    >
      {Icon && <Icon />}
      {action.label}
    </DropdownMenuItem>
  );
}

/**
 * A menu given as data: a dropdown at the pointer on a computer, the bottom
 * sheet (`ActionSheet`) where menus are sheets (`useSheetMenus`). `shown`
 * outlives `open` while it animates out (the caller keeps its last
 * request), so it doesn't jump or empty.
 */
export function ActionMenu({
  open,
  shown,
  onClose,
  finalFocus,
}: {
  open: boolean;
  shown: ActionMenuRequest | null;
  onClose: () => void;
  finalFocus?: false;
}) {
  const sheet = useSheetMenus();
  const groups = (shown?.groups ?? []).filter((group) => group.length > 0);

  if (sheet) {
    return (
      <ActionSheet
        open={open}
        onOpenChange={(open) => !open && onClose()}
        title={shown?.title ?? ''}
        groups={groups}
      />
    );
  }

  return (
    <DropdownMenu open={open} onOpenChange={(open) => !open && onClose()} modal={shown?.modal ?? true}>
      <DropdownMenuTrigger
        nativeButton={false}
        render={
          <span
            aria-hidden
            tabIndex={-1}
            className='pointer-events-none fixed size-px'
            style={{ left: shown?.x ?? 0, top: shown?.y ?? 0 }}
          />
        }
      />
      <DropdownMenuContent className='w-auto min-w-52' finalFocus={finalFocus}>
        {groups.map((group, i) => (
          <Fragment key={group[0].id}>
            {i > 0 && <DropdownMenuSeparator />}
            {group.map((action) => (
              <DropdownItem key={action.id} action={action} />
            ))}
          </Fragment>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
