import { useEffect, useState } from 'react';
import { events } from '@/lib/backend';
import { isSamePath } from '@/lib/path-utils';

/**
 * Goes up each time `path` changes on disk (another device, another app), so
 * a viewer that loaded it once can load it again. The app's own writes don't
 * count: the watcher leaves them out.
 */
export function useFileVersion(path: string): number {
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let stop: (() => void) | undefined;
    let cancelled = false;
    void events.fileSystemChanged
      .listen((event) => {
        const changed = event.payload.changes.some(
          (change) => change.kind !== 'Removed' && change.entry && isSamePath(change.path, path),
        );
        if (changed) setVersion((v) => v + 1);
      })
      .then((unlisten) => {
        if (cancelled) unlisten();
        else stop = unlisten;
      });
    return () => {
      cancelled = true;
      stop?.();
    };
  }, [path]);

  return version;
}
