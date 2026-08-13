// components/blank-tab.tsx
import { runCommand } from '@/lib/commands';
import { Button } from './ui/button';
import { FilePlusCorner, LucideIcon, Search, X } from 'lucide-react';
import { useKeymapStore } from '@/lib/stores/keymap';
import { CommandId } from '@/bindings';
import { Keybind } from './keybind';
import MonochromeIcon from "@/assets/icons/app/icon_transparent.svg?react";

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

export function BlankTab({}: { tabId: string }) {
  const commands = useKeymapStore((s) => s.commands);

  return (
    <div className='flex h-full w-full flex-col items-center justify-center gap-3 text-muted-foreground gap-y-16'>
      <MonochromeIcon className='size-40 opacity-50' />
      <div className='grid grid-cols-2 items-center gap-x-8'>
        {blankTabActions.map((action) => {
          return (
            <>
              <Button
                variant='link'
                size='lg'
                className='text-muted-foreground justify-end'
                onClick={() => runCommand(action.commandId)}
              >
                <action.icon />
                {action.label}
              </Button>
              <div>
                <Keybind
                  accelerator={
                    commands.find((c) => c.id === action.commandId)
                      ?.default_accelerator ?? ''
                  }
                />
              </div>
            </>
          );
        })}
      </div>
    </div>
  );
}
