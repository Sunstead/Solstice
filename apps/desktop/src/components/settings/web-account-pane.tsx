import { useEffect, useState } from 'react';
import { Button } from '@sunstead/ui/components/button';
import { me, signOut } from '@/lib/backend/web/account';
import { useSync } from '@/lib/stores/sync';
import { SyncStatusText } from '@/components/sync/status';

function Heading({ children }: { children: React.ReactNode }) {
  return <h3 className='pb-1 text-xs font-medium text-muted-foreground'>{children}</h3>;
}

/**
 * The Sync section in the browser: the web app is the server, so there's
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
    <div className='flex flex-col gap-6'>
      <section>
        <Heading>Account</Heading>
        <div className='flex items-center justify-between gap-4'>
          <p className='text-sm'>
            {username ? (
              <>
                Signed in as <span className='font-medium'>{username}</span> on {location.host}
              </>
            ) : (
              'Signed in'
            )}
          </p>
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
      </section>
      {info && (
        <section>
          <Heading>{info.vault_name}</Heading>
          <SyncStatusText info={info} />
        </section>
      )}
      <p className='text-xs text-muted-foreground'>
        Your notes here are the vaults on this server. To sync a folder on a computer, use the Solstice desktop
        app.
      </p>
    </div>
  );
}
