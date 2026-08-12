// components/blank-tab.tsx
import { runCommand } from '@/lib/commands';
import { Button } from './ui/button';
import { FilePlusCorner, Search, X } from 'lucide-react';

export function BlankTab({ tabId }: { tabId: string }) {
  return (
    <div className='flex h-full w-full flex-col items-center justify-center gap-3 text-muted-foreground'>
      <div className='grid grid-cols-1 items-stretch'>
        <div className='flex flex-col items-start'>
          <Button
            variant='link'
            size='lg'
            className='text-muted-foreground'
            onClick={() => runCommand('file.new_note')}
          >
            <FilePlusCorner />
            Create new note...
          </Button>
          <Button
            variant='link'
            size='lg'
            className='text-muted-foreground'
            onClick={() => runCommand('file.open_file')}
          >
            <Search />
            Open note...
          </Button>
          <Button
            variant='link'
            size='lg'
            className='text-muted-foreground'
            onClick={() => runCommand('file.close_tab')}
          >
            <X />
            Close tab
          </Button>
        </div>
      </div>
    </div>
  );
}
