import { useEffect } from 'react';
import { create } from 'zustand';

import { commands, events, type SyncInfo, type SyncReview } from '@/bindings';
import { useWorkspace } from '@/hooks/use-workspace';
import { normalizePath } from '@/lib/path-utils';

/**
 * Solstice Sync for the open workspace: whether it's linked, how it's doing,
 * and the merges waiting for review. The Rust side runs the sync; this only
 * mirrors it, refreshed whenever it reports a change.
 */
type SyncState = {
  info: SyncInfo | null;
  reviews: SyncReview[];
  refresh: () => Promise<void>;
};

export const useSync = create<SyncState>((set) => ({
  info: null,
  reviews: [],
  refresh: async () => {
    const [info, reviews] = await Promise.all([commands.syncStatus(), commands.syncReviews()]);
    set({
      info: info.status === 'ok' ? info.data : null,
      reviews: reviews.status === 'ok' ? reviews.data : [],
    });
  },
}));

/** Whether the open workspace syncs (and so editors merge instead of asking). */
export function isSynced(): boolean {
  return useSync.getState().info !== null;
}

/** The review for `path` (absolute), if its note has one. */
export function useReviewFor(path: string): SyncReview | undefined {
  const root = useWorkspace((s) => s.path);
  return useSync((s) => {
    if (!root) return undefined;
    const base = normalizePath(root);
    const full = normalizePath(path);
    if (!full.startsWith(`${base}/`)) return undefined;
    const rel = full.slice(base.length + 1);
    return s.reviews.find((r) => r.path?.toLowerCase() === rel.toLowerCase());
  });
}

/**
 * Keeps the store current: on every workspace switch and every change the
 * Rust side reports. Mount once, near the root.
 */
export function useSyncStatus() {
  const workspace = useWorkspace((s) => s.path);

  useEffect(() => {
    const refresh = () => void useSync.getState().refresh();
    refresh();
    // The client starts a moment after the workspace opens.
    const soon = setTimeout(refresh, 1000);
    const unlisten = events.syncChanged.listen(refresh);
    return () => {
      clearTimeout(soon);
      void unlisten.then((stop) => stop());
    };
  }, [workspace]);
}
