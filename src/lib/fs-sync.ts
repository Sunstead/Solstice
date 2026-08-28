import type { FsChange } from '@/bindings';
import { useFiles } from '@/hooks/use-files';
import { useLayout } from '@/hooks/use-layout';
import { useWorkspace } from '@/hooks/use-workspace';
import { useFileIndex } from '@/lib/stores/use-file-index';
import { useWikilinkIndex } from '@/lib/stores/wikilink-index';
import { isSamePath, isWithin, parentOf } from '@/lib/path-utils';
import { isBufferDirty } from '@/lib/stores/buffer-status';
import {
  abandonPendingWrites,
  noteExternalChange,
} from '@/lib/stores/external-changes';

/**
 * The single reconciler for filesystem changes, whatever caused them. The
 * watcher hands it batches from disk; `file-operations` hands it the changes it
 * just made itself. Routing both through here is what keeps in-app and
 * external edits behaving identically -- by construction rather than by
 * maintaining two parallel implementations.
 *
 * Every step is idempotent, because the two paths overlap: an in-app rename
 * applies here immediately *and* again when the watcher reports it.
 */
export async function applyFsChanges(changes: FsChange[]): Promise<void> {
  const root = useWorkspace.getState().path;
  if (!root || changes.length === 0) return;

  const files = useFiles.getState();
  const fileIndex = useFileIndex.getState();

  const dirsToRefresh = new Set<string>();
  let indexNeedsRewalk = false;
  let wikilinksNeedRebuild = false;

  for (const change of changes) {
    const gonePaths = [
      change.kind === 'Removed' ? change.path : null,
      change.from,
    ].filter((path): path is string => path !== null);

    // --- sidebar tree ---
    for (const path of gonePaths) files.removeSubtree(path);

    for (const path of [change.path, change.from]) {
      if (!path) continue;
      const parent = parentOf(path);

      // Only directories the tree has actually read are refreshed. Anything
      // never expanded is loaded lazily on first expand anyway, so fetching it
      // now would be work the user never asked for -- and `childrenLoaded`
      // rather than `expanded` is the right gate, since collapsing a folder
      // keeps its cached children.
      const known = useFiles.getState().entries[parent];
      if (isSamePath(parent, root) || known?.childrenLoaded) {
        dirsToRefresh.add(parent);
      }
    }

    // --- flat search index ---
    if (change.entry) fileIndex.upsertEntry(change.entry);
    else fileIndex.removeEntry(change.path);
    for (const path of gonePaths) fileIndex.removeEntry(path);

    // A directory that was created or moved can arrive already full (a
    // `git checkout`, a folder dragged in from Finder), and its descendants'
    // paths all have to change. Patching that by hand is exactly the drift
    // risk a re-walk avoids -- but it stays reserved for that case, since
    // paying a recursive walk per autosave would not be acceptable.
    if (change.entry?.is_dir && (change.from || change.kind === 'Created')) {
      indexNeedsRewalk = true;
    }

    // --- open tabs ---
    routeToTabs(change);

    // The wikilink index is keyed purely on paths, so content edits -- the
    // overwhelmingly common case -- can never affect it.
    if (change.kind !== 'Modified') wikilinksNeedRebuild = true;
  }

  await Promise.all(
    [...dirsToRefresh].map((dir) => useFiles.getState().refreshDirectory(dir)),
  );

  if (indexNeedsRewalk) await useFileIndex.getState().loadIndex(root);
  if (wikilinksNeedRebuild) void useWikilinkIndex.getState().rebuild(root);
}

function routeToTabs(change: FsChange) {
  const layout = useLayout.getState();

  if (change.from) {
    // The editor flushes its autosaver when its path prop changes, and that
    // write would recreate the file at the old path -- along with its parent
    // directory, since `write_file` calls `create_dir_all`.
    abandonPendingWrites(change.from);
    layout.retargetTabs(change.from, change.path);
    return;
  }

  if (change.kind === 'Removed') {
    handleRemoval(change.path);
    return;
  }

  // A content change only matters to an editor that has the file open; the
  // editor decides for itself whether it can reload silently.
  if (change.kind === 'Modified') {
    for (const tabPath of layout.listTabPaths()) {
      if (!isSamePath(tabPath, change.path)) continue;
      noteExternalChange({ kind: 'modified', path: tabPath, at: Date.now() });
    }
  }
}

/**
 * A deleted file with a clean buffer just closes, matching what an in-app
 * delete does. One with unsaved edits keeps its tab and surfaces the choice --
 * closing it would destroy work that exists nowhere else.
 */
export function handleRemoval(path: string) {
  const layout = useLayout.getState();

  // Directory removals are reported as the single directory path, so the
  // affected tabs have to be found by prefix.
  const affected = layout
    .listTabPaths()
    .filter((tabPath) => isWithin(tabPath, path));

  for (const tabPath of affected) {
    if (isBufferDirty(tabPath)) {
      noteExternalChange({ kind: 'removed', path: tabPath, at: Date.now() });
      continue;
    }

    abandonPendingWrites(tabPath);
    layout.closeFileTab(tabPath);
  }
}

/**
 * Describes a change the app just made itself, so it can go through
 * `applyFsChanges` on the same terms as a watcher event. `entry` is what the
 * path looks like *after* the operation -- `null` means it is gone.
 */
export function selfChange(
  kind: FsChange['kind'],
  path: string,
  options: { from?: string; isDir?: boolean } = {},
): FsChange {
  const { from, isDir } = options;
  const name = path.slice(parentOf(path).length).replace(/^[\\/]+/, '');

  return {
    kind,
    path,
    from: from ?? null,
    entry:
      kind === 'Removed' ? null : { name, path, is_dir: isDir ?? false },
  };
}
