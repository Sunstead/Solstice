import { createElement } from 'react';
import { Actions, type Model, type TabNode } from 'flexlayout-react';
import { FileText, Plus, X } from 'lucide-react';

import { Button } from '@sunstead/ui/components/button';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@sunstead/ui/components/sheet';
import { getFileIcon } from '@/assets/icons';
import { useLayout } from '@/hooks/use-layout';
import { useSetting } from '@/lib/settings/store';
import { closeTab } from '@/lib/tab-motion';
import { cn, getFileExtension } from '@/lib/utils';
import { allTabs, tabTitle } from './tabs';

function TabIcon({ tab }: { tab: TabNode }) {
  if (tab.getComponent() !== 'editor') return <FileText className='size-4 text-muted-foreground' />;
  const config = tab.getConfig() as { path?: string } | undefined;
  // The registry's icons are static; this only looks one up.
  return <span className='size-4 shrink-0'>{createElement(getFileIcon(getFileExtension(config?.path ?? '')))}</span>;
}

/** Every open tab, as a list to pick from or close; the phone layout's tab strip. */
export function TabSwitcher({
  model,
  shown,
  open,
  onOpenChange,
}: {
  model: Model;
  shown: TabNode | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const showExtensions = useSetting('explorer.showFileExtensions');
  const tabs = allTabs(model);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side='bottom' className='max-h-[80dvh] gap-0 rounded-t-xl pb-[env(safe-area-inset-bottom)]'>
        <SheetHeader className='pb-2'>
          <SheetTitle>Tabs</SheetTitle>
          <SheetDescription className='sr-only'>Switch to or close an open tab.</SheetDescription>
        </SheetHeader>
        <div role='listbox' aria-label='Open tabs' className='flex min-h-0 flex-col gap-0.5 overflow-y-auto px-2'>
          {tabs.map((tab) => (
            <div
              key={tab.getId()}
              role='option'
              aria-selected={tab === shown}
              className={cn('flex items-center gap-1 rounded-lg pr-1', tab === shown && 'bg-muted')}
            >
              <button
                type='button'
                className='flex min-h-11 min-w-0 flex-1 items-center gap-3 px-3 text-left text-sm'
                onClick={() => {
                  model.doAction(Actions.selectTab(tab.getId()));
                  onOpenChange(false);
                }}
              >
                <TabIcon tab={tab} />
                <span className='truncate'>{tabTitle(tab, showExtensions)}</span>
              </button>
              {tab.isEnableClose() && (
                <Button
                  variant='ghost'
                  size='icon'
                  className='text-muted-foreground'
                  onClick={() => closeTab(model, tab.getId(), { pointer: false })}
                >
                  <X />
                  <span className='sr-only'>Close {tabTitle(tab, showExtensions)}</span>
                </Button>
              )}
            </div>
          ))}
        </div>
        <div className='p-2'>
          <Button
            variant='outline'
            className='h-11 w-full'
            onClick={() => {
              useLayout.getState().newBlankTab();
              onOpenChange(false);
            }}
          >
            <Plus />
            New tab
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
