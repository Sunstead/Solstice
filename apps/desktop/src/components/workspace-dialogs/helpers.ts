import { useEffect, useState } from 'react';

import { commands } from '@/lib/backend';
import { useAccount } from '@/lib/stores/account';
import { useKnownWorkspaces } from '@/lib/stores/known-workspaces';
import { useSetting } from '@/lib/settings/store';

export function host(server: string) {
  try {
    return new URL(server).host;
  } catch {
    return server;
  }
}

export function joinPath(parent: string, name: string) {
  const sep = parent.includes('\\') ? '\\' : '/';
  return parent.endsWith(sep) ? `${parent}${name}` : `${parent}${sep}${name}`;
}

/** Where a new workspace goes: the last place one went, else Documents. */
export function useWorkspaceParent() {
  const [parent, setParent] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void (async () => {
      const remembered = await useKnownWorkspaces.getState().lastParent();
      const found = remembered ?? (await commands.defaultWorkspaceParent());
      if (live) setParent(found);
    })();
    return () => {
      live = false;
    };
  }, []);
  return [parent, setParent] as const;
}

/**
 * Who's signed in to the sync server, refreshed when a dialog opens, and a
 * sign-in for when nobody is.
 */
export function useSyncAccount() {
  const server = useSetting('sync.server');
  const username = useAccount((s) => s.username);
  const loaded = useAccount((s) => s.loaded);
  const refresh = useAccount((s) => s.refresh);
  const [signingIn, setSigningIn] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void refresh(server);
  }, [server, refresh]);

  const signIn = async () => {
    setSigningIn(true);
    setError(null);
    const result = await commands.syncSignIn(server);
    if (result.status === 'error') setError(result.error);
    await refresh(server);
    setSigningIn(false);
  };

  return { server, username, loaded, signIn, signingIn, error };
}
