import { type SyncVault } from '@/bindings';
import { Input } from '@sunstead/ui/components/input';
import { cn } from '@/lib/utils';

/**
 * Pick a vault on the server, or a new one. `choice` is a vault id or `new`.
 * With `onName`, the new vault's name is typed here; without it, `name` is
 * only shown (it comes from elsewhere, like the workspace's name).
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
  onName?: (name: string) => void;
}) {
  return (
    <div className='flex flex-col gap-1' role='radiogroup'>
      {vaults.map((v) => (
        <label key={v.id} className='flex items-center gap-2'>
          <input type='radio' checked={choice === v.id} onChange={() => onChoice(v.id)} />
          {v.name}
        </label>
      ))}
      <label className='flex items-center gap-2'>
        <input type='radio' checked={choice === 'new'} onChange={() => onChoice('new')} />
        {onName ? (
          <>
            New vault
            <Input
              className={cn('h-7 max-w-56', choice !== 'new' && 'opacity-50')}
              value={name}
              onChange={(e) => {
                onName(e.target.value);
                onChoice('new');
              }}
            />
          </>
        ) : (
          <span>
            New vault{name.trim() && <span className='text-muted-foreground'> named {name.trim()}</span>}
          </span>
        )}
      </label>
    </div>
  );
}
