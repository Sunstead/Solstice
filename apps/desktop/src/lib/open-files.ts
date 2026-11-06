import { useEffect } from 'react';

import { useLayout } from '@/hooks/use-layout';
import { useWorkspace } from '@/hooks/use-workspace';
import { commands, events } from '@/lib/backend';
import { can } from '@/lib/backend/platform';
import { getFileNameFromPath } from '@/lib/path-utils';
import { openDeepLink } from '@/hooks/use-deep-links';

/**
 * Opens files from outside the app (Finder, Open With, a drop) as tabs,
 * wherever they are on disk. A window with no workspace gets tabs of its
 * own (not saved: they're the files it was asked to open). Returns false
 * while a workspace's layout is still loading, to be asked again.
 */
export function openExternalFiles(paths: string[]): boolean {
  if (paths.length === 0) return true;
  if (!useLayout.getState().model) {
    if (useWorkspace.getState().path) return false;
    useLayout.getState().openLoose();
  }
  for (const path of paths) useLayout.getState().openFile(path, getFileNameFromPath(path));
  return true;
}

/**
 * Takes the files and links the OS asked this window to open (`take_pending_opens`),
 * once the window has somewhere to put them, and whenever more come.
 */
export function useOpenFiles() {
  const ready = useWorkspace((s) => !s.loading);
  const workspace = useWorkspace((s) => s.path);
  const hasModel = useLayout((s) => s.model !== null);

  useEffect(() => {
    if (!can.multiWindow || !ready || (workspace && !hasModel)) return;
    const drain = async () => {
      const pending = await commands.takePendingOpens();
      // `solstice://` links share the queue (`route_links`).
      const links = pending.filter((item) => item.startsWith('solstice:'));
      const paths = pending.filter((item) => !item.startsWith('solstice:'));
      // Taken from the queue, so they're opened here or not at all.
      if (!openExternalFiles(paths)) console.warn('Files to open arrived before the layout:', paths);
      for (const link of links) await openDeepLink(link);
    };
    void drain();
    const unlisten = events.openFilesQueued.listen(() => void drain());
    return () => void unlisten.then((f) => f());
  }, [ready, workspace, hasModel]);
}
