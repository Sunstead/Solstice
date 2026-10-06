import { useEffect, useState } from 'react';
import { Button } from '@sunstead/ui/components/button';
import { me, signOut } from '@/lib/backend/web/account';
import { useSync } from '@/lib/stores/sync';
import { SyncStatusLine } from '@/components/sync/status';
import { UserAvatar } from '@/components/user-avatar';
import { Card, Heading } from './pane-parts';

/**
 * The Account section in the browser: the web app is the server, so there's
 * nothing to link, only who's signed in and the open vault's state.
 */
export function WebAccountPane() {
  const [username, setUsername] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const info = useSync((s) => s.info);

  useEffect(() => {
    void me()
      .then((m) => setUsername(m.username))
      .catch(() => setUsername(null));
  }, []);

  return (
    <div className='flex flex-col gap-7'>
      <section>
        <Heading>Account</Heading>
        <Card>
          <div className='flex items-center gap-3'>
            <UserAvatar username={username} size='lg' />
            <div className='min-w-0 flex-1'>
              <p>
                Signed in as <span className='font-medium'>{username ?? '…'}</span>
              </p>
              <p className='truncate text-muted-foreground'>{location.host}</p>
            </div>
            <Button
              variant='outline'
              size='sm'
              disabled={busy}
              onClick={() => {
                setBusy(true);
                void signOut().finally(() => setBusy(false));
              }}
            >
              Sign out
            </Button>
          </div>
        </Card>
      </section>
      {info && (
        <section>
          <Heading>This vault</Heading>
          <Card>
            <div className='flex flex-col gap-1'>
              <p className='font-medium'>{info.vault_name}</p>
              <SyncStatusLine info={info} />
            </div>
          </Card>
        </section>
      )}
      <p className='text-xs text-muted-foreground'>
        Your vaults on Solstice Sync open here. To sync a folder on your computer, use the Solstice desktop app.
      </p>
    </div>
  );
}
