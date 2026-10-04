import { useEffect, useState } from 'react';

import { Button } from '@sunstead/ui/components/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@sunstead/ui/components/dialog';
import { Input } from '@sunstead/ui/components/input';
import { Label } from '@sunstead/ui/components/label';

/** Asks for the URL a new link card should point at. */
export function CanvasLinkDialog({
  open,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (url: string) => void;
}) {
  const [url, setUrl] = useState('');

  // Cleared on open rather than on submit, so a cancelled dialog does not
  // reopen still holding the last attempt.
  useEffect(() => {
    if (open) setUrl('');
  }, [open]);

  const submit = () => {
    const trimmed = url.trim();
    if (!trimmed) return;
    onSubmit(trimmed);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a link card</DialogTitle>
          <DialogDescription>
            The card shows the site and opens it when clicked.
          </DialogDescription>
        </DialogHeader>

        <div className='grid gap-3'>
          <Label htmlFor='canvas-link-url'>URL</Label>
          <Input
            id='canvas-link-url'
            value={url}
            autoFocus
            placeholder='https://example.com'
            onChange={(event) => setUrl(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                submit();
              }
            }}
          />
        </div>

        <DialogFooter>
          <DialogClose render={<Button variant='outline'>Cancel</Button>} />
          <Button onClick={submit} disabled={url.trim() === ''}>
            Add
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
