import { useState, type ComponentType } from 'react';
import { ChevronLeft } from 'lucide-react';

import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { Row, RowGroup } from '@/components/mobile/phone-parts';

/** One choice in an action sheet; one with `items` opens them in its place. */
export type Action = {
  id: string;
  label: string;
  icon?: ComponentType<{ className?: string }>;
  destructive?: boolean;
  disabled?: boolean;
  onSelect?: () => void;
  items?: Action[];
};

/**
 * What a menu at the finger is on a computer, as a bottom sheet on a touch
 * screen (`touchFirst`), as iOS apps ask: grouped rows, a submenu opening in
 * the sheet's place with a way back. Choosing closes it first, so what the
 * choice opens (a picker, a dialog) never lands under it.
 */
export function ActionSheet({
  open,
  onOpenChange,
  title,
  groups,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  groups: Action[][];
}) {
  const [sub, setSub] = useState<Action | null>(null);
  const shown = sub ? [sub.items ?? []] : groups.filter((group) => group.length > 0);
  const choose = (action: Action) => () => {
    if (action.items) return setSub(action);
    onOpenChange(false);
    action.onSelect?.();
  };

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) setSub(null);
      }}
    >
      <SheetContent
        side='bottom'
        showCloseButton={false}
        finalFocus={false}
        className='max-h-[85dvh] gap-0 rounded-t-2xl bg-sidebar pb-[env(safe-area-inset-bottom)]'
      >
        <div className='flex items-center gap-1 px-4 pt-5 pb-3'>
          {sub && (
            <button
              type='button'
              onClick={() => setSub(null)}
              className='-ml-1 flex size-8 items-center justify-center rounded-full text-primary active:opacity-60'
            >
              <ChevronLeft className='size-5' />
              <span className='sr-only'>Back to {title}</span>
            </button>
          )}
          <SheetTitle className='px-1 text-[17px] font-semibold'>{sub?.label ?? title}</SheetTitle>
          <SheetDescription className='sr-only'>Choose an action</SheetDescription>
        </div>
        <div className='flex min-h-0 flex-col gap-4 overflow-y-auto px-4 pb-4'>
          {shown.map((group, i) => (
            <RowGroup key={i} tone='sheet'>
              {group.map((action) => (
                <Row
                  key={action.id}
                  icon={action.icon}
                  label={action.label}
                  destructive={action.destructive}
                  disabled={action.disabled}
                  chevron={!!action.items}
                  onClick={choose(action)}
                />
              ))}
            </RowGroup>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}
