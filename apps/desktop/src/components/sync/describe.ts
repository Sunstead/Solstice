import type { SyncInfo } from '@/bindings';

/** The sync state in a few words. */
export function describe(info: SyncInfo): string {
  switch (info.state) {
    case 'synced':
      return 'Up to date';
    case 'syncing':
      return 'Syncing…';
    case 'connecting':
      return 'Connecting…';
    case 'offline':
      return "Offline. Changes sync when you're back online.";
    case 'signed_out':
      return 'Signed out';
    case 'relink':
      return 'Needs setting up again';
    case 'deleted':
      return 'Vault deleted on the server';
    default:
      return info.state;
  }
}

/** Whether this state is waiting on the user, rather than on the network. */
export function needsAttention(info: SyncInfo | null): boolean {
  if (!info) return false;
  return info.state === 'signed_out' || info.state === 'relink' || info.state === 'deleted' || info.reviews > 0;
}
