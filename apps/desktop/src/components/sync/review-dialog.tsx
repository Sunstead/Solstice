import { useEffect, useState } from 'react';

import { commands } from '@/lib/backend';
import { type SyncReview, type SyncVersions } from '@/bindings';
import { Button } from '@sunstead/ui/components/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@sunstead/ui/components/dialog';
import { cn } from '@/lib/utils';
import { useSync } from '@/lib/stores/sync';

type Choice = 'merged' | 'local' | 'remote';

/**
 * The versions behind a flagged merge, side by side: what each device had
 * and what the merge made. Choosing one saves it as the note (an ordinary
 * edit, so it syncs) and clears the review everywhere.
 */
export function ReviewDialog({ review, onClose }: { review: SyncReview; onClose: () => void }) {
  const [versions, setVersions] = useState<SyncVersions | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [choice, setChoice] = useState<Choice>('merged');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void commands.syncReviewVersions(review.id).then((r) => {
      if (r.status === 'ok') setVersions(r.data);
      else setError(r.error);
    });
  }, [review.id]);

  const columns: { id: Choice; label: string; text: string | null | undefined }[] = [
    { id: 'local', label: `On ${review.device}`, text: versions?.local },
    { id: 'remote', label: 'On the other device', text: versions?.remote },
    { id: 'merged', label: 'Merged', text: versions?.merged },
  ];

  const apply = async () => {
    if (!versions) return;
    setBusy(true);
    const text = choice === 'merged' ? null : (columns.find((c) => c.id === choice)?.text ?? null);
    const result = await commands.syncResolveReview(review.id, text);
    setBusy(false);
    if (result.status === 'error') {
      setError(result.error);
      return;
    }
    void useSync.getState().refresh();
    onClose();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className='sm:max-w-5xl'>
        <DialogHeader>
          <DialogTitle>Review merged edits</DialogTitle>
          <DialogDescription>
            {review.path ?? 'This note'} was edited in the same place on two devices. Pick the version
            to keep; you can edit it further afterwards.
          </DialogDescription>
        </DialogHeader>

        {error && <p className='text-sm text-destructive'>{error}</p>}

        <div className='grid gap-3 md:grid-cols-3'>
          {columns.map((c) => (
            <button
              key={c.id}
              type='button'
              aria-pressed={choice === c.id}
              onClick={() => setChoice(c.id)}
              className={cn(
                'flex min-w-0 flex-col gap-1.5 rounded-md border p-2 text-left',
                choice === c.id ? 'border-primary ring-1 ring-primary' : 'border-border hover:bg-muted/50',
              )}
            >
              <span className='text-xs font-medium text-muted-foreground'>{c.label}</span>
              <pre className='max-h-80 min-h-24 overflow-auto whitespace-pre-wrap break-words font-mono text-xs'>
                {versions ? (c.text ?? 'Not available') : 'Loading...'}
              </pre>
            </button>
          ))}
        </div>

        <DialogFooter>
          <Button variant='ghost' onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void apply()} disabled={!versions || busy}>
            {choice === 'merged' ? 'Keep merged' : 'Use this version'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
