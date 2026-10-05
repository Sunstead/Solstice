import { Button } from '@sunstead/ui/components/button';
import { Label } from '@sunstead/ui/components/label';
import { open as pickFolder } from '@/lib/backend/shell';
import { host, joinPath, type useSyncAccount } from './helpers';

/** The folder a workspace will be made in, with Browse… and the full path it will have. */
export function LocationField({
  parent,
  onParent,
  name,
  disabled,
}: {
  parent: string | null;
  onParent: (parent: string) => void;
  name: string;
  disabled?: boolean;
}) {
  const browse = async () => {
    const picked = await pickFolder({ directory: true, defaultPath: parent ?? undefined });
    if (typeof picked === 'string') onParent(picked);
  };
  return (
    <div className='grid gap-2'>
      <Label>Location</Label>
      <div className='flex items-center gap-2'>
        <p className='min-w-0 flex-1 truncate text-muted-foreground' title={parent ?? undefined}>
          {parent ? joinPath(parent, name || '…') : 'Choose a folder'}
        </p>
        <Button type='button' variant='outline' size='sm' disabled={disabled} onClick={() => void browse()}>
          Browse…
        </Button>
      </div>
    </div>
  );
}

/** Says why syncing isn't available yet, and offers to sign in. */
export function SyncSignIn({ account }: { account: ReturnType<typeof useSyncAccount> }) {
  if (!account.server) {
    return <p className='text-muted-foreground'>Set a sync server in Settings &gt; Sync first.</p>;
  }
  return (
    <div className='grid gap-1'>
      <div className='flex items-center justify-between gap-4'>
        <p className='text-muted-foreground'>Sign in to {host(account.server)} to sync.</p>
        <Button
          type='button'
          variant='outline'
          size='sm'
          disabled={account.signingIn}
          onClick={() => void account.signIn()}
        >
          {account.signingIn ? 'Signing in…' : 'Sign in'}
        </Button>
      </div>
      {account.error && <p className='text-destructive'>{account.error}</p>}
    </div>
  );
}
