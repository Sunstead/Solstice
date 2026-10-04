import { create } from 'zustand';

import { commands } from '@/lib/backend';

/**
 * Who's signed in to the sync server, for the account button. On the web
 * that's the session; on desktop, the sign-in kept for `sync.server`.
 */
type AccountState = {
  username: string | null;
  /** Why the server couldn't say, e.g. it's unreachable. */
  error: string | null;
  loaded: boolean;
  refresh: (server: string) => Promise<void>;
};

export const useAccount = create<AccountState>((set) => ({
  username: null,
  error: null,
  loaded: false,
  refresh: async (server) => {
    if (!server) {
      set({ username: null, error: null, loaded: true });
      return;
    }
    const result = await commands.syncAccount(server);
    set(
      result.status === 'ok'
        ? { username: result.data, error: null, loaded: true }
        : { username: null, error: result.error, loaded: true },
    );
  },
}));
