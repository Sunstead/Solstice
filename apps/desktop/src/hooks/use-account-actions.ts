import { useEffect, useState } from 'react';

import { ask } from '@/lib/ask';
import { commands } from '@/lib/backend';
import { can, deviceNoun } from '@/lib/backend/platform';
import { signOut } from '@/lib/backend/web/account';
import { needsAttention } from '@/components/sync/describe';
import { useSetting } from '@/lib/settings/store';
import { useAccount } from '@/lib/stores/account';
import { useSettingsDialog } from '@/lib/stores/settings-dialog';
import { useSync } from '@/lib/stores/sync';

function host(server: string) {
  try {
    return new URL(server).host;
  } catch {
    return server;
  }
}

/**
 * Who's signed in to the sync server, and signing in or out: the rail's
 * account button and the phone's You page.
 */
export function useAccountActions() {
  const configured = useSetting('sync.server');
  // The web app's server is the page's own origin.
  const server = can.syncSettings ? configured : location.origin;
  const { username, error, loaded, refresh } = useAccount();
  const openSettings = useSettingsDialog((s) => s.openSettings);
  const attention = useSync((s) => needsAttention(s.info));
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  // Asked again when sync's view of the sign-in may have changed, not on every
  // sync event: each ask could refresh the token.
  const reach = useSync((s) => {
    const state = s.info?.state;
    return state === 'signed_out' || state === 'synced' ? state : 'other';
  });
  useEffect(() => {
    void refresh(server);
  }, [server, refresh, reach]);

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
    if (!(await confirmSignOut(server))) return;
    setBusy(true);
    setFailure(null);
    if (can.syncSettings) {
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

  return {
    server,
    host: server ? host(server) : null,
    username,
    status,
    attention,
    busy,
    failure,
    signIn,
    signOut: leave,
    refresh: () => void refresh(server),
  };
}

/** Signing out stops sync until signing in again, so it asks first. */
export function confirmSignOut(server: string | null) {
  return ask({
    title: 'Sign out?',
    message: server
      ? `Your notes stay on this ${deviceNoun}, but stop syncing with ${host(server)} until you sign in again.`
      : undefined,
    confirm: 'Sign Out',
    destructive: true,
  });
}
