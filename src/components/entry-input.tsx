import { useState } from 'react';
import { EntryKind } from '@/lib/stores/entry-input';
import { cn, getFileExtension } from '@/lib/utils';
import { getFileIcon, getFolderIcon } from '@/assets/icons';
import { InputGroup, InputGroupAddon, InputGroupInput } from './ui/input-group';
import { ChevronRight } from 'lucide-react';

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
  onSubmit: (finalName: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initialValue);

  const isFolder = kind.type === 'folder';
  const preset = kind.type === 'file' ? kind.preset : null;

  const Icon = isFolder
    ? getFolderIcon()
    : getFileIcon(preset ? preset.extension : getFileExtension(name));

  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed) {
      onCancel();
      return;
    }

    const finalName =
      !isFolder && preset ? `${trimmed}.${preset.extension}` : trimmed;

    onSubmit(finalName);
  };

  return (
    <InputGroup
      style={{
        paddingLeft: !isFolder ? 'calc((1 / var(--dpr)) * -1px + 24px)' : '0px',
      }}
      className={cn('h-8' /* !isFolder && 'pl-5.75' */)}
      onBlur={onCancel}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          submit();
        } else if (e.key === 'Escape') {
          onCancel();
        }
      }}
    >
      <InputGroupInput
        value={name}
        onChange={(e) => setName(e.target.value)}
        onFocus={(e) => e.target.select()}
        className='pl-2! h-8'
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
  );
}
