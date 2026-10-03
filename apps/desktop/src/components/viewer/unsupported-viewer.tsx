import { openPath } from '@tauri-apps/plugin-opener';
import { FileQuestion } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { basename } from '@/lib/wikilink/target';
import { ViewerFrame } from './viewer-frame';

/** Anything the app has no renderer for; the OS almost certainly does. */
export function UnsupportedViewer({ path }: { path: string }) {
  if (!path) {
    return (
      <div className='flex h-full items-center justify-center p-6 text-sm text-muted-foreground'>
        No file open.
      </div>
    );
  }

  return (
    <ViewerFrame path={path}>
      <div className='flex h-full flex-col items-center justify-center gap-3 p-6 text-center'>
        <FileQuestion className='size-8 text-muted-foreground' />
        <div className='space-y-1'>
          <p className='text-sm font-medium'>{basename(path)}</p>
          <p className='text-sm text-muted-foreground'>
            Solstice can't preview this file type.
          </p>
        </div>
        <Button variant='outline' size='sm' onClick={() => void openPath(path)}>
          Open in default app
        </Button>
      </div>
    </ViewerFrame>
  );
}
