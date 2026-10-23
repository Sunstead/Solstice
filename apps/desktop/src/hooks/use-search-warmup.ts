import { useEffect } from 'react';

import { useWorkspace } from '@/hooks/use-workspace';
import { commands } from '@/lib/backend';
import { useSetting } from '@/lib/settings/store';
import { parseExcludes } from '@/lib/stores/search';

/** Long enough after opening a workspace that its first paint goes first. */
const AFTER_MS = 2000;

/**
 * Reads the open workspace into the search index in the background, so the
 * first search doesn't wait on reading every PDF. Mostly from the cache: only
 * what changed since is read.
 */
export function useSearchWarmup() {
  const root = useWorkspace((s) => s.path);
  const exclude = useSetting('search.exclude');

  useEffect(() => {
    if (!root) return;
    const timer = window.setTimeout(() => {
      void commands.warmSearchIndex(root, parseExcludes(exclude));
    }, AFTER_MS);
    return () => window.clearTimeout(timer);
  }, [root, exclude]);
}
