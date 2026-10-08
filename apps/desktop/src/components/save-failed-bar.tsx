import { CloudOff } from 'lucide-react';

import { Button } from '@sunstead/ui/components/button';

/**
 * A write failed (offline, the server's down, the disk refused). The edit is
 * still in the editor and the autosaver keeps retrying; this only says so.
 *
 * Rendered inside the editor's own scroll container, hence `sticky`.
 */
export function SaveFailedBar({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div
      role='status'
      title={message}
      className='sticky top-0 z-20 flex flex-wrap items-center gap-2 border-b border-destructive/40 bg-destructive/10 px-3 py-2 text-sm'
    >
      <CloudOff className='size-4 shrink-0 text-destructive' />
      <span className='min-w-0 flex-1'>Not saved yet. Your changes are kept here and saved when Solstice can.</span>
      <Button size='sm' variant='outline' onClick={onRetry}>
        Retry now
      </Button>
    </div>
  );
}
