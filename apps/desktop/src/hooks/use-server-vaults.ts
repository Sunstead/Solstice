import { useEffect, useState } from 'react';

import { commands } from '@/lib/backend';
import { type SyncVault } from '@/bindings';

/** The vaults on `server`, loaded while `enabled`. */
export function useServerVaults(server: string, enabled = true) {
  const [result, setResult] = useState<{ server: string; vaults?: SyncVault[]; error?: string } | null>(null);

  useEffect(() => {
    if (!enabled || !server) return;
    let live = true;
    void commands.syncVaults(server).then((r) => {
      if (!live) return;
      setResult(r.status === 'error' ? { server, error: r.error } : { server, vaults: r.data });
    });
    return () => {
      live = false;
    };
  }, [server, enabled]);

  // A result for another server is stale.
  const current = result?.server === server ? result : null;
  return { vaults: current?.vaults ?? null, error: current?.error ?? null };
}
