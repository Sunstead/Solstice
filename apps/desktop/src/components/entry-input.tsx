import { useRef, useState } from 'react';
import { EntryKind } from '@/lib/stores/entry-input';
import { cn, getFileExtension } from '@/lib/utils';
import { getFileIcon, getFolderIcon } from '@/assets/icons';
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from '@sunstead/ui/components/input-group';
import { ChevronRight } from 'lucide-react';

/** What creating or renaming reports back: an error keeps the field open. */
export type EntryResult = { status: 'ok' } | { status: 'error'; error: string };

/**
 * The name field for a new or renamed entry. Enter, and leaving the field
 * (Done on iOS's keyboard bar blurs it), both submit; an empty or unchanged
 * name and Escape cancel.
 */
export function EntryInput({
  kind,
  initialValue = '',
  expanded = false,
  onSubmit,
  onCancel,
}: {
  kind: EntryKind;
  initialValue?: string;
  expanded?: boolean;
  onSubmit: (finalName: string) => Promise<EntryResult>;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initialValue);
  const [error, setError] = useState<string | null>(null);
  // Once submitted or cancelled, the blur from unmounting must do nothing.
  const settled = useRef(false);

  const isFolder = kind.type === 'folder';
  const preset = kind.type === 'file' ? kind.preset : null;

  const Icon = isFolder
    ? getFolderIcon()
    : getFileIcon(preset ? preset.extension : getFileExtension(name));

  const cancel = () => {
    if (settled.current) return;
    settled.current = true;
    onCancel();
  };

  const submit = async () => {
    if (settled.current) return;
    const trimmed = name.trim();
    if (!trimmed || trimmed === initialValue) {
      cancel();
      return;
    }

    const finalName =
      !isFolder && preset ? `${trimmed}.${preset.extension}` : trimmed;

    settled.current = true;
    const result = await onSubmit(finalName);
    if (result.status === 'error') {
      settled.current = false;
      setError(result.error);
    }
  };

  return (
    <div>
      <InputGroup
        style={{
          paddingLeft: !isFolder
            ? 'calc((1 / var(--dpr)) * -1px + 24px)'
            : '0px',
        }}
        className={cn('h-8 pointer-coarse:h-11', error && 'border-destructive')}
        onBlur={(e) => {
          if (e.currentTarget.contains(e.relatedTarget)) return;
          // Leaving a name that failed gives up on it, or it would stay forever.
          if (error) cancel();
          else void submit();
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            void submit();
          } else if (e.key === 'Escape') {
            cancel();
          }
        }}
      >
        <InputGroupInput
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setError(null);
          }}
          onFocus={(e) => e.target.select()}
          className='pl-2! h-8 pointer-coarse:h-11'
          aria-invalid={error ? true : undefined}
          enterKeyHint='done'
          autoCapitalize='off'
          autoCorrect='off'
          spellCheck={false}
          autoFocus
        />
        <InputGroupAddon
          className={cn(isFolder && '' /* "pl-1.75" */)}
          style={{
            paddingLeft: isFolder ? 'calc((1 / var(--dpr)) * -1px + 8px)' : '',
          }}
        >
          {isFolder && (
            <ChevronRight
              className={cn('text-foreground', expanded && 'rotate-90')}
            />
          )}
          <Icon />
        </InputGroupAddon>
      </InputGroup>
      {error && <p className='px-2 pt-1 text-xs text-destructive'>{error}</p>}
    </div>
  );
}
