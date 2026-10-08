import { useState } from 'react';
import type { Model, TabNode } from 'flexlayout-react';
import { ArrowLeft, ArrowRight, ChevronLeft, Ellipsis } from 'lucide-react';

import { Button } from '@sunstead/ui/components/button';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@sunstead/ui/components/sheet';
import { SyncIndicator } from '@/components/sync/status';
import { targetFromPath } from '@/lib/entry-actions';
import { useEntryMenuItems, type EntryMenuItem } from '@/lib/entry-menu-items';
import { getFileNameFromPath } from '@/lib/path-utils';
import { stepHistory, tabPath } from './phone-history';
import { useSetting } from '@/lib/settings/store';
import { usePhoneNav } from '@/lib/stores/phone-nav';
import { PhoneHeader, PhoneTitle, Row, RowGroup } from './phone-parts';
import { TabSwitcher } from './tab-switcher';
import { allTabs, tabTitle } from './tabs';

/** The note's top bar: back to the files, its name, sync, its tabs, and what can be done with it. */
export function NoteHeader({ model, shown }: { model: Model; shown: TabNode | null }) {
  const showExtensions = useSetting('explorer.showFileExtensions');
  const goHome = usePhoneNav((s) => s.goHome);
  const [tabsOpen, setTabsOpen] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);
  const count = allTabs(model).length;

  return (
    <PhoneHeader>
      <Button variant='ghost' size='icon' onClick={goHome}>
        <ChevronLeft />
        <span className='sr-only'>Files</span>
      </Button>
      <PhoneTitle className='px-0 text-[15px]'>{shown ? tabTitle(shown, showExtensions) : ''}</PhoneTitle>
      <div className='flex items-center gap-0.5'>
        <SyncIndicator />
        <Button variant='ghost' size='icon' onClick={() => setTabsOpen(true)}>
          <span className='flex size-5 items-center justify-center rounded-[5px] border-[1.5px] border-current text-[11px] leading-none font-semibold'>
            {count > 99 ? '99+' : count}
          </span>
          <span className='sr-only'>Tabs</span>
        </Button>
        <Button variant='ghost' size='icon' onClick={() => setActionsOpen(true)}>
          <Ellipsis />
          <span className='sr-only'>More</span>
        </Button>
      </div>
      <TabSwitcher model={model} shown={shown} open={tabsOpen} onOpenChange={setTabsOpen} />
      <NoteActions path={tabPath(shown)} open={actionsOpen} onOpenChange={setActionsOpen} />
    </PhoneHeader>
  );
}

/**
 * What the ⋯ offers: back and forward through the notes shown here, then the
 * file's own actions (the ones its menus have everywhere else).
 */
function NoteActions({
  path,
  open,
  onOpenChange,
}: {
  path: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const canBack = usePhoneNav((s) => s.back.length > 0);
  const canForward = usePhoneNav((s) => s.forward.length > 0);
  const close = (run: () => void) => () => {
    onOpenChange(false);
    run();
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side='bottom'
        finalFocus={false}
        className='max-h-[85dvh] gap-0 rounded-t-xl pb-[env(safe-area-inset-bottom)]'
      >
        <SheetHeader className='pb-2'>
          <SheetTitle className='truncate'>{path ? getFileNameFromPath(path).replace(/\.md$/i, '') : 'Tab'}</SheetTitle>
          <SheetDescription className='sr-only'>Actions for this note</SheetDescription>
        </SheetHeader>
        <div className='flex min-h-0 flex-col gap-5 overflow-y-auto px-4 pb-4'>
          <div className='grid grid-cols-2 gap-2'>
            <Button variant='outline' className='h-11' disabled={!canBack} onClick={close(() => stepHistory('back', path))}>
              <ArrowLeft />
              Back
            </Button>
            <Button
              variant='outline'
              className='h-11'
              disabled={!canForward}
              onClick={close(() => stepHistory('forward', path))}
            >
              Forward
              <ArrowRight />
            </Button>
          </div>
          {path && <FileRows path={path} onDone={() => onOpenChange(false)} />}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function FileRows({ path, onDone }: { path: string; onDone: () => void }) {
  const items = useEntryMenuItems(targetFromPath(path), { surface: 'editor' });

  // The menu's separators become the gaps between groups; a submenu's items
  // become a group of their own, named for it.
  const groups: EntryMenuItem[][] = [[]];
  for (const item of items) {
    if (item.kind === 'separator') groups.push([]);
    else if (item.kind === 'submenu') {
      const named = item.items.map((sub) => (sub.kind === 'item' ? { ...sub, label: `${item.label} (${sub.label})` } : sub));
      groups.push(named, []);
    }
    else groups[groups.length - 1].push(item);
  }

  return groups
    .filter((group) => group.some((item) => item.kind === 'item'))
    .map((group, index) => (
      <RowGroup key={index}>
        {group.map(
          (item) =>
            item.kind === 'item' && (
              <Row
                key={item.id}
                icon={item.icon}
                label={item.label.replace(/\.\.\.$|…$/, '')}
                destructive={item.destructive}
                disabled={item.disabled}
                onClick={() => {
                  onDone();
                  item.run();
                }}
              />
            ),
        )}
      </RowGroup>
    ));
}
