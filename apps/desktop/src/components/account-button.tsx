import { LogIn, LogOut, Settings2 } from 'lucide-react';

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
import { can } from '@/lib/backend/platform';
import { UserAvatar } from '@/components/user-avatar';
import { useSettingsDialog } from '@/lib/stores/settings-dialog';
import { useAccountActions } from '@/hooks/use-account-actions';

/**
 * The rail's account button: who's signed in to the sync server, and signing
 * in or out. The details live in Settings > Sync (Account on the web).
 */
export function AccountButton() {
  const openSettings = useSettingsDialog((s) => s.openSettings);
  const { host, username, status, attention, busy, failure, signIn, signOut: leave, refresh } = useAccountActions();

  return (
    <DropdownMenu onOpenChange={(open) => open && refresh()}>
      <DropdownMenuTrigger
        render={<Button variant='ghost' size='icon' className='size-10' />}
      >
        <UserAvatar username={username} attention={attention} className='size-7' />
        <span className='sr-only'>{username ? `Account: ${username}` : 'Account'}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent side='right' align='end' sideOffset={8} className='min-w-56'>
        <DropdownMenuGroup>
          <DropdownMenuLabel className='flex items-center gap-2.5 font-normal'>
            <UserAvatar username={username} />
            <span className='flex min-w-0 flex-col gap-0.5'>
              {username ? (
                <span className='truncate text-sm text-foreground'>
                  Signed in as <span className='font-medium'>{username}</span>
                </span>
              ) : (
                <span className='text-sm text-foreground'>{status}</span>
              )}
              {host && <span className='truncate text-xs text-muted-foreground'>{host}</span>}
              {failure && <span className='text-xs text-destructive'>{failure}</span>}
            </span>
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        {username ? (
          <DropdownMenuItem disabled={busy} closeOnClick={false} onClick={() => void leave()}>
            <LogOut />
            Sign out
          </DropdownMenuItem>
        ) : (
          can.syncSettings && (
            <DropdownMenuItem disabled={busy} closeOnClick={false} onClick={() => void signIn()}>
              <LogIn />
              Sign in
            </DropdownMenuItem>
          )
        )}
        <DropdownMenuItem onClick={() => openSettings('sync')}>
          <Settings2 />
          {can.syncSettings ? 'Sync settings…' : 'Account settings…'}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
