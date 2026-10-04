import { useState } from 'react';
import { GitMerge, Undo2 } from 'lucide-react';

import { commands, type SyncReview } from '@/bindings';
import { Button } from '@sunstead/ui/components/button';
import { useSync } from '@/lib/stores/sync';
import { ReviewDialog } from './review-dialog';

/**
 * Shown on a note whose sync merge wants a look: two devices edited the same
 * text offline, or it was edited on one while deleted on another. Rendered
 * inside the editor's own scroll container, hence `sticky`, like the
 * external-change bar.
 */
export function ReviewBar({ review }: { review: SyncReview }) {
  const [open, setOpen] = useState(false);
  const restored = review.kind === 'restored';

  const dismiss = async () => {
    await commands.syncResolveReview(review.id, null);
    void useSync.getState().refresh();
  };

  return (
    <>
      <div className='sticky top-0 z-20 flex flex-wrap items-center gap-2 border-b border-sky-500/40 bg-sky-500/10 px-3 py-2 text-sm'>
        {restored ? (
          <Undo2 className='size-4 shrink-0 text-sky-600 dark:text-sky-400' />
        ) : (
          <GitMerge className='size-4 shrink-0 text-sky-600 dark:text-sky-400' />
        )}
        <span className='min-w-0 flex-1'>
          {restored
            ? 'This note was deleted on another device while it was being edited, so it was kept.'
            : 'Two devices edited the same part of this note while offline. Their edits were merged.'}
        </span>
        {!restored && (
          <Button size='sm' variant='outline' onClick={() => setOpen(true)}>
            Review
          </Button>
        )}
        <Button size='sm' variant='ghost' onClick={() => void dismiss()}>
          {restored ? 'OK' : 'Keep merged'}
        </Button>
      </div>
      {open && <ReviewDialog review={review} onClose={() => setOpen(false)} />}
    </>
  );
}
