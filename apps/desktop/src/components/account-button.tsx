import { useEffect, useState } from 'react';
import { CircleUser, LogIn, LogOut, Settings2 } from 'lucide-react';

import { Button } from '@sunstead/ui/components/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@sunstead/ui/components/dropdown-menu';
import { commands, events, isDesktop } from '@/lib/backend';
import { signOut } from '@/lib/backend/web/account';
import { useAccount } from '@/lib/stores/account';
import { useSettingsDialog } from '@/lib/stores/settings-dialog';
import { useSetting } from '@/lib/settings/store';

function host(server: string) {
  try {
    return new URL(server).host;
  } catch {
    return server;
  }
}

/**
 * The rail's account button: who's signed in to the sync server, and signing
 * in or out. The details live in Settings > Sync (Account on the web).
 */
export function AccountButton() {
  const configured = useSetting('sync.server');
  // The web app's server is the page's own origin.
  const server = isDesktop ? configured : location.origin;
  const { username, error, loaded, refresh } = useAccount();
  const openSettings = useSettingsDialog((s) => s.openSettings);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    void refresh(server);
    const unlisten = events.syncChanged.listen(() => void refresh(server));
    return () => void unlisten.then((stop) => stop());
  }, [server, refresh]);

  const signIn = async () => {
    if (!server) {
      openSettings('sync');
      return;
    }
    setBusy(true);
    setFailure(null);
    const result = await commands.syncSignIn(server);
    if (result.status === 'error') setFailure(result.error);
    await refresh(server);
    setBusy(false);
  };

  const leave = async () => {
    setBusy(true);
    setFailure(null);
    if (isDesktop) {
      const result = await commands.syncSignOut(server);
      if (result.status === 'error') setFailure(result.error);
      await refresh(server);
    } else {
      await signOut();
    }
    setBusy(false);
  };

  const status = username
    ? null
    : !server
      ? 'No sync server set'
      : error
        ? `Can't reach ${host(server)}`
        : loaded
          ? 'Not signed in'
          : 'Checking…';

  return (
    <DropdownMenu onOpenChange={(open) => open && void refresh(server)}>
      <DropdownMenuTrigger
        render={<Button variant='ghost' size='icon' className='size-10' />}
      >
        <CircleUser className='size-5' />
        <span className='sr-only'>Account</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent side='right' align='end' sideOffset={8} className='min-w-56'>
        <DropdownMenuGroup>
          <DropdownMenuLabel className='flex flex-col gap-0.5 font-normal'>
            {username ? (
              <span className='text-sm'>
                Signed in as <span className='font-medium'>{username}</span>
              </span>
            ) : (
              <span className='text-sm'>{status}</span>
            )}
            {server && <span className='text-xs text-muted-foreground'>{host(server)}</span>}
            {failure && <span className='text-xs text-destructive'>{failure}</span>}
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        {username ? (
          <DropdownMenuItem disabled={busy} closeOnClick={false} onClick={() => void leave()}>
            <LogOut />
            Sign out
          </DropdownMenuItem>
        ) : (
          isDesktop && (
            <DropdownMenuItem disabled={busy} closeOnClick={false} onClick={() => void signIn()}>
              <LogIn />
              Sign in
            </DropdownMenuItem>
          )
        )}
        <DropdownMenuItem onClick={() => openSettings('sync')}>
          <Settings2 />
          {isDesktop ? 'Sync settings…' : 'Account…'}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
