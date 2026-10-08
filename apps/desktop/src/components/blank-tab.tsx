import { useSyncExternalStore } from 'react';
import { FilePlusCorner, Frame, type LucideIcon, Search, X } from 'lucide-react';
import { Button } from '@sunstead/ui/components/button';

import { ScrollArea } from '@sunstead/ui/components/scroll-area';
import { useSidebar } from '@sunstead/ui/components/resizable-sidebar';
import MonochromeIcon from '@/assets/icons/app/icon_transparent.svg?react';
import { getFileIcon } from '@/assets/icons';
import type { CommandId } from '@/bindings';
import { useLayout } from '@/hooks/use-layout';
import { allTabs } from '@/components/mobile/tabs';
import { runCommand } from '@/lib/commands';
import { getFileNameFromPath, parentOf } from '@/lib/path-utils';
import { useKeymapStore } from '@/lib/stores/keymap';
import React from 'react';
import { useRecentFiles } from '@/lib/stores/recent-files';
import { useFileIndex } from '@/lib/stores/use-file-index';
import { useWorkspace } from '@/hooks/use-workspace';
import { getFileExtension } from '@/lib/utils';
import { Keybind } from './keybind';

const actions: { label: string; icon: LucideIcon; commandId: CommandId }[] = [
  { label: 'New note', icon: FilePlusCorner, commandId: 'file.new_note' },
  { label: 'New canvas', icon: Frame, commandId: 'file.new_canvas' },
  { label: 'Open note…', icon: Search, commandId: 'file.open_file' },
];
const close = { label: 'Close tab', icon: X, commandId: 'file.close_tab' as const };

const RECENT = 5;

function Row({
  icon: Icon,
  label,
  detail,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  detail?: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type='button'
      onClick={onClick}
      className='flex h-10 w-full items-center gap-3 rounded-lg px-2 text-left text-sm text-foreground/90 hover:bg-accent active:bg-accent pointer-coarse:h-12'
    >
      <span className='flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground pointer-coarse:size-8'>
        <Icon className='size-4' />
      </span>
      <span className='min-w-0 flex-1 truncate'>{label}</span>
      {detail}
    </button>
  );
}

const coarse = typeof window !== 'undefined' ? window.matchMedia('(pointer: coarse)') : null;
const subscribeCoarse = (onChange: () => void) => {
  coarse?.addEventListener('change', onChange);
  return () => coarse?.removeEventListener('change', onChange);
};

/**
 * What an empty tab offers. With a keyboard, the actions beside their
 * shortcuts; on a touch screen (a phone, an iPad), one column of rows to tap,
 * and the files opened lately.
 */
export function BlankTab(_props: { tabId: string }) {
  const { isMobile } = useSidebar();
  const touch = useSyncExternalStore(subscribeCoarse, () => !!coarse?.matches, () => false);
  return isMobile || touch ? <TouchBlankTab /> : <KeyboardBlankTab />;
}

function TouchBlankTab() {
  const { isMobile } = useSidebar();
  const tabCount = useLayout((s) => (s.model ? allTabs(s.model).length : 0));
  const root = useWorkspace((s) => s.path);
  const recent = useRecent();

  // The phone's tab switcher closes tabs; a lone tab has nothing to close to.
  const shown = isMobile || tabCount < 2 ? actions : [...actions, close];

  return (
    <ScrollArea className='h-full [&>div]:block!'>
      <div className='flex min-h-full w-full flex-col items-center justify-center gap-10 px-6 py-16'>
        <MonochromeIcon className='size-24 min-h-24 text-muted-foreground opacity-40' />
        <div className='flex w-full max-w-sm flex-col gap-6'>
          <div className='flex flex-col gap-0.5'>
            {shown.map((action) => (
              <Row
                key={action.commandId}
                icon={action.icon}
                label={action.label}
                onClick={() => void runCommand(action.commandId)}
              />
            ))}
          </div>
          {recent.length > 0 && (
            <section className='flex flex-col gap-0.5'>
              <h3 className='px-2 pb-1 text-xs font-medium text-muted-foreground'>Recent</h3>
              {recent.map((path) => {
                const name = getFileNameFromPath(path);
                const folder = root ? parentOf(path).slice(root.length).replace(/^[/\\]/, '') : '';
                return (
                  <Row
                    key={path}
                    icon={getFileIcon(getFileExtension(name))}
                    label={name.replace(/\.md$/, '')}
                    detail={folder && <span className='max-w-[40%] truncate text-xs text-muted-foreground'>{folder}</span>}
                    onClick={() => useLayout.getState().openFile(path, name)}
                  />
                );
              })}
            </section>
          )}
        </div>
      </div>
    </ScrollArea>
  );
}

/** Recent files that still exist, newest first. */
function useRecent(): string[] {
  const paths = useRecentFiles((s) => s.paths);
  const files = useFileIndex((s) => s.files);
  const known = new Set(files.map((f) => f.path));
  return paths.filter((p) => known.has(p)).slice(0, RECENT);
}

const blankTabActions: {
  label: string;
  icon: LucideIcon;
  commandId: CommandId;
}[] = [
  {
    label: 'Create new note...',
    icon: FilePlusCorner,
    commandId: 'file.new_note',
  },
  {
    label: 'Create new canvas...',
    icon: Frame,
    commandId: 'file.new_canvas',
  },
  {
    label: 'Open note...',
    icon: Search,
    commandId: 'file.open_file',
  },
  {
    label: 'Close tab',
    icon: X,
    commandId: 'file.close_tab',
  },
];

/** The new-tab page with a keyboard: actions beside their shortcuts. */
function KeyboardBlankTab() {
  const commands = useKeymapStore((s) => s.commands);

  return (
    <ScrollArea className='h-full [&>div]:block!'>
      <div className='flex flex-col w-full min-h-full py-16'>
        <div className='flex flex-1 w-full flex-col items-center justify-center gap-y-16 text-muted-foreground'>
          <MonochromeIcon className='size-40 opacity-50 min-h-40' />
          <div className='grid grid-cols-2 items-center gap-x-8'>
            {blankTabActions.map((action) => (
              <React.Fragment key={action.commandId}>
                <Button
                  variant='link'
                  size='lg'
                  className='text-muted-foreground justify-end'
                  onClick={() => runCommand(action.commandId)}
                >
                  <action.icon />
                  {action.label}
                </Button>
                {/* No keyboard to press them on a touch screen. */}
                <div className='pointer-coarse:invisible'>
                  <Keybind
                    accelerator={
                      commands.find((c) => c.id === action.commandId)
                        ?.accelerator ?? ''
                    }
                  />
                </div>
              </React.Fragment>
            ))}
          </div>
        </div>
      </div>
    </ScrollArea>
  );
}
