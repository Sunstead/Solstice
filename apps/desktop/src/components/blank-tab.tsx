// components/blank-tab.tsx
import { runCommand } from '@/lib/commands';
import { Button } from '@sunstead/ui/components/button';
import { FilePlusCorner, Frame, LucideIcon, Search, X } from 'lucide-react';
import { useKeymapStore } from '@/lib/stores/keymap';
import { CommandId } from '@/bindings';
import { Keybind } from './keybind';
import MonochromeIcon from '@/assets/icons/app/icon_transparent.svg?react';
import React from 'react';
import { ScrollArea } from '@sunstead/ui/components/scroll-area';

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

export function BlankTab(_props: { tabId: string }) {
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
