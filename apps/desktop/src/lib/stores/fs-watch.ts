import { getCurrentWindow } from '@/lib/backend/window';

import { commands, events } from '@/lib/backend';
import { type FsChange } from '@/bindings';
import { getSetting, subscribeToSetting } from '@/lib/settings/store';
import { useFiles } from '@/hooks/use-files';
import { useWorkspace } from '@/hooks/use-workspace';
import { applyFsChanges, handleRemoval } from '@/lib/fs-sync';
import { useLayout } from '@/hooks/use-layout';
import { bumpResync } from '@/lib/stores/external-changes';
import { isSamePath } from '@/lib/path-utils';
import { useFileIndex } from '@/lib/stores/use-file-index';
import { useWikilinkIndex } from '@/lib/stores/wikilink-index';

/**
 * Bridges the Rust filesystem watcher to `applyFsChanges`, and re-reads the
 * workspace when the window regains focus.
 *
 * Deliberately a module rather than a hook: StrictMode double-mounts, none of
 * the stores this drives are React-scoped, and the subscription has to outlive
 * whichever components happen to be mounted. The `unlisten` guards mirror
 * `keymap.ts`, which subscribes the same way.
 */

let unlistenChanges: (() => void) | null = null;
let unlistenFocus: (() => void) | null = null;
let unsubscribeSetting: (() => void) | null = null;
let unsubscribeWorkspace: (() => void) | null = null;
let starting: Promise<void> | null = null;

// Rust already debounced these. This only merges flushes that land in the same
// frame -- a `git checkout` produces several back to back -- so it stays small.
const COALESCE_MS = 60;

// A focus resync walks the whole workspace, and macOS routinely reports two
// focus events for one app switch.
const RESYNC_THROTTLE_MS = 2000;

let queue: FsChange[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function flush() {
  flushTimer = null;
  const batch = queue;
  queue = [];
  if (batch.length > 0) void applyFsChanges(batch);
}

function enqueue(changes: FsChange[]) {
  queue.push(...changes);
  if (flushTimer === null) flushTimer = setTimeout(flush, COALESCE_MS);
}

export function startFsWatch(): Promise<void> {
  if (unlistenChanges) return Promise.resolve();
  if (starting) return starting;

  starting = (async () => {
    const stopChanges = await events.fileSystemChanged.listen((event) => {
      // Batches from a workspace that has since been closed or switched away
      // from would reconcile against the wrong tree.
      const root = useWorkspace.getState().path;
      if (!root || root !== event.payload.root) return;

      enqueue(event.payload.changes);
    });

    const stopFocus = await getCurrentWindow().onFocusChanged(
      ({ payload: focused }) => {
        if (focused) void resyncFromDisk();
      },
    );

    unlistenChanges = stopChanges;
    unlistenFocus = stopFocus;
    unsubscribeSetting = subscribeToSetting(
      'explorer.watchFilesystem',
      applyWatchSetting,
    );

    // `set_workspace` starts a watcher unconditionally -- it has no view of
    // the setting. The setting subscription above only fires when the resolved
    // value *changes*, so switching between two workspaces that both disable
    // watching would leave the new one watched. Re-applying on every switch
    // closes that.
    unsubscribeWorkspace = useWorkspace.subscribe((state, prev) => {
      if (state.path !== prev.path) applyWatchSetting();
    });

    applyWatchSetting();
  })();

  return starting.finally(() => {
    starting = null;
  });
}

/**
 * Pushes `explorer.watchFilesystem` down to the OS watcher rather than just
 * muting events here -- switching it off is meant to relieve the actual cost
 * of a recursive watch, not hide its output.
 */
function applyWatchSetting() {
  void commands
    .setWatchEnabled(getSetting('explorer.watchFilesystem'))
    .then((result) => {
      if (result.status === 'error') {
        console.error('Failed to update filesystem watch:', result.error);
      }
    });
}

export function stopFsWatch(): void {
  unlistenChanges?.();
  unlistenFocus?.();
  unsubscribeSetting?.();
  unsubscribeWorkspace?.();
  unlistenChanges = null;
  unlistenFocus = null;
  unsubscribeSetting = null;
  unsubscribeWorkspace = null;

  if (flushTimer !== null) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  queue = [];
}

/**
 * Re-reads everything the app caches about the workspace. This is the safety
 * net under the watcher: FSEvents coalesces aggressively, a suspended app
 * misses events outright, and the watcher deliberately ignores dotfiles that
 * `explorer.showHiddenFiles` can un-hide. Re-listing directories heals all
 * three, because `list_directory` filters nothing.
 *
 * O(workspace) per call, which is why it is throttled. If that ever becomes
 * too slow the fix is an mtime on `FileEntry` to diff against, rather than a
 * cheaper walk.
 */
export async function resyncFromDisk(force = false): Promise<void> {
  const root = useWorkspace.getState().path;
  if (!root) return;
  if (typeof document !== 'undefined' && document.hidden) return;

  const lastLoadedAt = useFileIndex.getState().lastLoadedAt;
  if (
    !force &&
    lastLoadedAt !== null &&
    Date.now() - lastLoadedAt < RESYNC_THROTTLE_MS
  ) {
    return;
  }

  await useFileIndex.getState().loadIndex(root);

  const loadedDirs = Object.values(useFiles.getState().entries)
    .filter((entry) => entry.is_dir && entry.childrenLoaded)
    .map((entry) => entry.path);

  await Promise.all(
    [root, ...loadedDirs].map((dir) =>
      useFiles.getState().refreshDirectory(dir),
    ),
  );

  void useWikilinkIndex.getState().rebuild(root);

  // Any tab whose file disappeared while the app was away is handled exactly
  // as a live deletion would be.
  const known = useFileIndex.getState().files;
  for (const tabPath of useLayout.getState().listTabPaths()) {
    const stillThere = known.some((file) => isSamePath(file.path, tabPath));
    if (!stillThere) handleRemoval(tabPath);
  }

  // Push, rather than have the reconciler reach for editor handles: every
  // mounted editor re-checks its own file against disk.
  bumpResync();
}
