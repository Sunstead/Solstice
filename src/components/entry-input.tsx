import { useState } from 'react';
import { EntryKind } from '@/lib/stores/entry-input';
import { cn, getFileExtension } from '@/lib/utils';
import { getFileIcon, getFolderIcon } from '@/assets/icons';
import { InputGroup, InputGroupAddon, InputGroupInput } from './ui/input-group';
import { ChevronRight } from 'lucide-react';

export function EntryInput({
  kind,
  initialValue = '',
  onSubmit,
  onCancel,
}: {
  kind: EntryKind;
  initialValue?: string;
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
      className={cn('h-8', !isFolder && 'pl-6')}
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
      <InputGroupAddon>
        {isFolder && <ChevronRight className='text-foreground' />}
        <Icon />
      </InputGroupAddon>
    </InputGroup>
  );
}
