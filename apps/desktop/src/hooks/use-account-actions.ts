import { useEffect, useState } from 'react';

import { commands, events } from '@/lib/backend';
import { can } from '@/lib/backend/platform';
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
