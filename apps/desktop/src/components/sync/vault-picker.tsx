import { Check, Cloud, Plus } from 'lucide-react';

import { type SyncVault } from '@/bindings';
import { Input } from '@sunstead/ui/components/input';
import { cn } from '@/lib/utils';

function Option({
  selected,
  onSelect,
  icon,
  children,
}: {
  selected: boolean;
  onSelect: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      type='button'
      role='radio'
      aria-checked={selected}
      onClick={onSelect}
      className={cn(
        'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-muted',
        selected && 'bg-muted',
      )}
    >
      {icon}
      <span className='min-w-0 flex-1 truncate'>{children}</span>
      {selected && <Check className='size-4 shrink-0' />}
    </button>
  );
}

/**
 * Pick a vault on the server, or a new one: `choice` is a vault id or `new`.
 * The new vault's name is typed under its option while it's chosen.
 */
export function VaultPicker({
  vaults,
  choice,
  onChoice,
  name,
  onName,
}: {
  vaults: SyncVault[];
  choice: string;
  onChoice: (choice: string) => void;
  name: string;
  onName: (name: string) => void;
}) {
  return (
    <div role='radiogroup' className='grid max-h-64 gap-1 overflow-y-auto rounded-md border p-1'>
      <Option
        selected={choice === 'new'}
        onSelect={() => onChoice('new')}
        icon={<Plus className='size-4 text-muted-foreground' />}
      >
        Create a new vault
      </Option>
      {choice === 'new' && (
        <div className='px-2 pb-1.5 pl-8'>
          <Input aria-label='New vault name' value={name} onChange={(e) => onName(e.target.value)} className='h-8' />
        </div>
      )}
      {vaults.length > 0 && (
        <p className='px-2 pt-2 pb-0.5 text-xs font-medium text-muted-foreground'>Use an existing vault</p>
      )}
      {vaults.map((v) => (
        <Option
          key={v.id}
          selected={choice === v.id}
          onSelect={() => onChoice(v.id)}
          icon={<Cloud className='size-4 text-muted-foreground' />}
        >
          {v.name}
        </Option>
      ))}
    </div>
  );
}
