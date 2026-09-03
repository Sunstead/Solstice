import { useEffect, useState } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';

import { commands } from '@/bindings';
import { useWorkspace } from '@/hooks/use-workspace';
import { isWithin } from '@/lib/path-utils';

/**
 * Paths already granted to the asset scope this session.
 *
 * Grants are cumulative and never revoked, so once a path is in here the URL
 * can be handed out synchronously -- which is what keeps reopening a file from
 * flashing a loading state it does not need.
 */
const granted = new Set<string>();

export type AssetUrl =
  | { status: 'loading' }
  | { status: 'ready'; url: string }
  | { status: 'error'; message: string };

function immediate(path: string): AssetUrl {
  if (!path) return { status: 'error', message: 'No file path' };

  // Opening the workspace already granted the whole directory, so the common
  // case -- a file inside the vault -- needs no round trip and no loading
  // frame at all. Only files from elsewhere pay for one.
  const workspace = useWorkspace.getState().path;
  if (granted.has(path) || (workspace && isWithin(path, workspace))) {
    return { status: 'ready', url: convertFileSrc(path) };
  }

  return { status: 'loading' };
}

/**
 * Turns an absolute path into an `asset:` URL the webview is actually allowed
 * to load.
 *
 * `convertFileSrc` alone is not enough: the asset protocol scope is granted
 * per workspace, so a file opened from outside the vault produces a URL that
 * looks fine and is then denied with nothing in the console. Asking for the
 * grant first costs one IPC round trip on first open and nothing afterwards.
 */
export function useAssetUrl(path: string): AssetUrl {
  const [state, setState] = useState<AssetUrl>(() => immediate(path));

  useEffect(() => {
    const known = immediate(path);
    setState(known);
    if (known.status !== 'loading') return;

    let cancelled = false;

    void commands
      .allowAssetPath(path)
      .then((result) => {
        if (cancelled) return;

        if (result.status === 'error') {
          setState({ status: 'error', message: result.error });
          return;
        }

        granted.add(path);
        setState({ status: 'ready', url: convertFileSrc(path) });
      })
      .catch((error: unknown) => {
        if (!cancelled) setState({ status: 'error', message: String(error) });
      });

    return () => {
      cancelled = true;
    };
  }, [path]);

  return state;
}
