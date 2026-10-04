import { useCallback, useEffect, useState } from 'react';

import { commands } from '@/lib/backend';
import { getSetting } from '@/lib/settings/store';
import { isSynced } from '@/lib/stores/sync';
import {
  clearExternalChange,
  useExternalChange,
  useFsResync,
} from '@/lib/stores/external-changes';

export type ExternalStatus =
  | { kind: 'none' }
  | { kind: 'conflict'; diskText: string }
  | { kind: 'deleted' };

type Options = {
  path: string;
  /** The editor is mounted and its document can be read/replaced. */
  ready: boolean;
  isDirty: () => boolean;
  getLastWritten: () => string;
  /** Whether disk content is *semantically* identical to the live document. */
  matchesBuffer: (diskText: string) => boolean;
  applyDiskContent: (text: string) => void;
  adopt: (text: string) => void;
  hold: () => void;
  release: () => void;
  /**
   * Write the buffer now. Editors whose saves sync merges (notes) pass it;
   * without it (canvases, which sync whole, last writer wins) a dirty buffer
   * still asks.
   */
  flush?: () => void;
};

/**
 * Decides what one editor should do about its file changing on disk.
 *
 * A clean buffer reloads in place; a dirty one holds its writes and surfaces
 * the choice, since either version would otherwise be discarded silently.
 * In a synced folder nothing has to be chosen: the buffer is saved, sync
 * merges it with the change, and the merged file then reloads here.
 */
export function useExternalFileChanges({
  path,
  ready,
  isDirty,
  getLastWritten,
  matchesBuffer,
  applyDiskContent,
  adopt,
  hold,
  release,
  flush,
}: Options) {
  const [status, setStatus] = useState<ExternalStatus>({ kind: 'none' });
  const change = useExternalChange(path);
  const resyncSeq = useFsResync((s) => s.seq);

  useEffect(() => {
    // A resync tick asks every editor to re-check; a change entry is a direct
    // report about this file. Either can trigger the check.
    if (!ready || !path) return;
    if (!change && resyncSeq === 0) return;

    let cancelled = false;

    const check = async () => {
      if (change?.kind === 'removed') {
        hold();
        clearExternalChange(path);
        if (!cancelled) setStatus({ kind: 'deleted' });
        return;
      }

      const result = await commands.readFile(path);
      if (cancelled) return;

      if (result.status === 'error') {
        // Unreadable is indistinguishable from deleted from here, and the
        // safe response is the same: stop writing and ask.
        hold();
        clearExternalChange(path);
        setStatus({ kind: 'deleted' });
        return;
      }

      const diskText = result.data;
      clearExternalChange(path);

      // Our own write coming back to us.
      if (diskText === getLastWritten()) return;

      if (isSynced() && flush) {
        // Unsaved edits are saved, merged by sync, and come back as another
        // change; a clean buffer just takes the merged file.
        if (isDirty()) {
          flush();
        } else {
          applyDiskContent(diskText);
          adopt(diskText);
        }
        return;
      }

      if (!isDirty() && getSetting('editor.externalChanges') !== 'prompt') {
        applyDiskContent(diskText);
        adopt(diskText);
        return;
      }

      // Milkdown's serializer normalizes markdown (`*` vs `-`, spacing,
      // trailing newline), so a hand-edited file that means the same thing
      // would otherwise read as a conflict on every check.
      if (matchesBuffer(diskText)) {
        adopt(diskText);
        return;
      }

      hold();
      setStatus({ kind: 'conflict', diskText });
    };

    void check();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [change, resyncSeq, path, ready]);

  // A new file in this editor starts from a clean slate.
  useEffect(() => {
    setStatus({ kind: 'none' });
  }, [path]);

  const reload = useCallback(() => {
    if (status.kind !== 'conflict') return;
    applyDiskContent(status.diskText);
    adopt(status.diskText);
    release();
    setStatus({ kind: 'none' });
  }, [status, applyDiskContent, adopt, release]);

  const keepMine = useCallback(() => {
    release();
    setStatus({ kind: 'none' });
  }, [release]);

  const dismiss = useCallback(() => {
    release();
    setStatus({ kind: 'none' });
  }, [release]);

  return { status, reload, keepMine, dismiss };
}
