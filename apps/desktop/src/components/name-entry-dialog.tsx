import { useRef, useState } from 'react';

import { Button } from '@sunstead/ui/components/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from '@sunstead/ui/components/input-group';
import { touchFirst } from '@/lib/backend/platform';
import { fileOperations } from '@/lib/file-operations';
import { type EntryOperation, useEntryInput } from '@/lib/stores/entry-input';
import { cn } from '@/lib/utils';

/**
 * Naming a new or renamed entry on a touch screen: a dialog instead of the
 * tree's inline field. It stays put while the keyboard comes and goes, works
 * with the sidebar collapsed, and only Create (or Return) commits, never
 * leaving the field, so writing with the Pencil or dismissing the keyboard
 * doesn't take a half-written name.
 */
export function NameEntryDialog() {
  const operation = useEntryInput((s) => s.operation);
  const cancel = useEntryInput((s) => s.cancel);
  const open = touchFirst && operation !== null;

  return (
    <Dialog open={open} onOpenChange={(next) => !next && cancel()}>
      <DialogContent className='sm:max-w-sm' showCloseButton={false}>
        {operation && <NameForm key={key(operation)} operation={operation} onDone={cancel} />}
      </DialogContent>
    </Dialog>
  );
}

function key(operation: EntryOperation): string {
  return operation.mode === 'create' ? `create:${operation.parentPath}` : `rename:${operation.path}`;
}

function title(operation: EntryOperation): string {
  const { kind } = operation;
  const what = kind.type === 'folder' ? 'Folder' : (kind.preset?.label ?? 'File');
  return operation.mode === 'create' ? `New ${what}` : `Rename ${what}`;
}

function NameForm({ operation, onDone }: { operation: EntryOperation; onDone: () => void }) {
  const initial = operation.mode === 'rename' ? operation.initialName : '';
  const [name, setName] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Everything is selected once, on opening; Scribble refocusing the field
  // mustn't select it again and have the next word replace the name.
  const selected = useRef(false);

  const preset = operation.kind.type === 'file' ? operation.kind.preset : null;
  const trimmed = name.trim();
  const ready = !!trimmed && !busy;

  const submit = async () => {
    if (!ready) return;
    if (operation.mode === 'rename' && trimmed === initial) return onDone();
    const finalName = preset ? `${trimmed}.${preset.extension}` : trimmed;
    setBusy(true);
    const result =
      operation.mode === 'rename'
        ? await fileOperations.rename(operation.path, finalName)
        : operation.kind.type === 'folder'
          ? await fileOperations.createFolder(operation.parentPath, finalName)
          : await fileOperations.createFile(operation.parentPath, finalName, operation.kind.preset);
    setBusy(false);
    if (result.status === 'error') setError(result.error);
    else onDone();
  };

  return (
    <form
      className='contents'
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <DialogHeader>
        <DialogTitle>{title(operation)}</DialogTitle>
      </DialogHeader>
      <div className='grid gap-2'>
        <InputGroup className={cn('h-11', error && 'border-destructive')}>
          <InputGroupInput
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setError(null);
            }}
            onFocus={(e) => {
              if (selected.current) return;
              selected.current = true;
              e.target.select();
            }}
            aria-label='Name'
            aria-invalid={error ? true : undefined}
            placeholder={operation.kind.type === 'folder' ? 'Folder name' : 'Name'}
            enterKeyHint='done'
            autoCapitalize='sentences'
            autoCorrect='off'
            spellCheck={false}
            autoFocus
          />
          {preset && (
            <InputGroupAddon align='inline-end'>
              <InputGroupText>.{preset.extension}</InputGroupText>
            </InputGroupAddon>
          )}
        </InputGroup>
        {error && <p className='text-xs text-destructive select-text'>{error}</p>}
      </div>
      <DialogFooter>
        <DialogClose render={<Button type='button' variant='outline' />}>Cancel</DialogClose>
        <Button type='submit' disabled={!ready}>
          {operation.mode === 'rename' ? 'Rename' : 'Create'}
        </Button>
      </DialogFooter>
    </form>
  );
}
