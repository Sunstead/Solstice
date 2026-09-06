import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/** What is being renamed, which is all that differs between the two cases. */
export type RenameKind = 'group' | 'edge';

const COPY: Record<RenameKind, { title: string; description: string; label: string }> =
  {
    group: {
      title: 'Rename group',
      description: 'The name sits above the group, outside its frame.',
      label: 'Name',
    },
    edge: {
      title: 'Edge label',
      description: 'The label sits at the middle of the line.',
      label: 'Label',
    },
  };

/**
 * Names a group or an edge. Empty is a legitimate answer -- it is how a label
 * is removed -- so there is no non-empty guard on the submit button.
 */
export function CanvasRenameDialog({
  open,
  kind,
  initialValue,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  kind: RenameKind;
  initialValue: string;
  onOpenChange: (open: boolean) => void;
  onSubmit: (label: string) => void;
}) {
  const [value, setValue] = useState(initialValue);

  // Seeded on open: the dialog outlives any one target, so a second rename
  // would otherwise still hold the first one's name.
  useEffect(() => {
    if (open) setValue(initialValue);
  }, [open, initialValue]);

  const copy = COPY[kind];

  const submit = () => {
    onSubmit(value);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{copy.title}</DialogTitle>
          <DialogDescription>{copy.description}</DialogDescription>
        </DialogHeader>

        <div className='grid gap-3'>
          <Label htmlFor='canvas-rename-value'>{copy.label}</Label>
          <Input
            id='canvas-rename-value'
            value={value}
            autoFocus
            placeholder='Leave empty to remove'
            onChange={(event) => setValue(event.target.value)}
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
          <Button onClick={submit}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
