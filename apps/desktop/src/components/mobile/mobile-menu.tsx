import { ChevronRight } from 'lucide-react';

import { type ResolvedMenuEntry } from '@/bindings';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@sunstead/ui/components/collapsible';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@sunstead/ui/components/sheet';
import { isCommandEnabled, runCommand } from '@/lib/commands';
import { collectCommandIds, NATIVE_SCOPED_COMMAND_IDS, runNativeItem, useMenuLayout } from '@/lib/menu-layout';
import { useActiveEditorStore } from '@/lib/stores/active-editor';
import { cn } from '@/lib/utils';

function Item({ label, disabled, onRun }: { label: string; disabled: boolean; onRun: () => void }) {
  return (
    <button
      type='button'
      disabled={disabled}
      // Keeps the editor's focus, and with it the command's target.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onRun}
      className='flex min-h-11 w-full items-center rounded-md px-3 text-left text-sm hover:bg-muted disabled:opacity-40'
    >
      {label}
    </button>
  );
}

function Entries({
  entries,
  enabled,
  onDone,
  depth = 0,
}: {
  entries: ResolvedMenuEntry[];
  enabled: Record<string, boolean>;
  onDone: () => void;
  depth?: number;
}) {
  return entries.map((entry, i) => {
    if (entry === 'Separator') return <div key={i} className='mx-3 my-1 h-px bg-border' />;
    if ('Command' in entry) {
      const c = entry.Command!;
      return (
        <Item
          key={i}
          label={c.label}
          disabled={!(enabled[c.id] ?? true)}
          onRun={() => {
            onDone();
            void runCommand(c.id);
          }}
        />
      );
    }
    if ('Native' in entry) {
      const n = entry.Native!;
      return (
        <Item
          key={i}
          label={n.label}
          disabled={!(enabled[NATIVE_SCOPED_COMMAND_IDS[n.item]] ?? true)}
          onRun={() => {
            onDone();
            runNativeItem(n.item);
          }}
        />
      );
    }
    const { title, entries: children } = entry.Submenu;
    return (
      <div key={i} className={cn('flex flex-col', depth === 0 && 'pl-3')}>
        <p className='px-3 pt-2 pb-1 text-xs font-medium text-muted-foreground'>{title}</p>
        <Entries entries={children} enabled={enabled} onDone={onDone} depth={depth + 1} />
      </div>
    );
  });
}

/**
 * The app menu as a sheet, for the phone layout: each top-level menu is a
 * section that opens in place, since there's no room for menus to open
 * sideways.
 */
export function MobileMenu({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const layout = useMenuLayout();
  useActiveEditorStore((s) => s.activeEditorId);
  useActiveEditorStore((s) => s.commandStateVersion);
  const done = () => onOpenChange(false);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side='bottom'
        finalFocus={false}
        className='max-h-[85dvh] gap-0 rounded-t-xl pb-[env(safe-area-inset-bottom)]'
      >
        <SheetHeader className='pb-2'>
          <SheetTitle>Menu</SheetTitle>
          <SheetDescription className='sr-only'>Every command in the app menu.</SheetDescription>
        </SheetHeader>
        <div className='flex min-h-0 flex-col overflow-y-auto px-2 pb-2'>
          {layout.map((menu) => {
            const enabled: Record<string, boolean> = {};
            for (const id of collectCommandIds(menu.entries)) enabled[id] = isCommandEnabled(id);
            return (
              <Collapsible key={menu.title}>
                <CollapsibleTrigger className='group flex min-h-11 w-full items-center gap-2 rounded-md px-3 text-left text-sm font-medium hover:bg-muted'>
                  <ChevronRight className='size-4 text-muted-foreground transition-transform group-data-[panel-open]:rotate-90' />
                  {menu.title}
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className='flex flex-col pb-1 pl-6'>
                    <Entries entries={menu.entries} enabled={enabled} onDone={done} />
                  </div>
                </CollapsibleContent>
              </Collapsible>
            );
          })}
        </div>
      </SheetContent>
    </Sheet>
  );
}
