import { commands } from '@/bindings';
import { applyFsChanges, selfChange } from '@/lib/fs-sync';
import type { FileTreeNode } from '@/hooks/use-files';
import { useLayout } from '@/hooks/use-layout';
import { joinPath, parentOf } from '@/lib/path-utils';
import { getPresetByExtension } from '@/lib/stores/entry-input';
import { getFileExtension } from '@/lib/utils';

/**
 * In-app operations apply optimistically through the same reconciler the
 * watcher uses, rather than waiting for the watcher to report them back. The
 * debounce would make creating a file feel broken, and a workspace whose
 * watcher failed to start has to stay fully usable. `applyFsChanges` is
 * idempotent, so the watcher re-reporting the same change is harmless.
 */

/** The subset of a FileTreeNode needed to move it. Matches what a react-dnd drag item carries. */
export type MovableEntry = Pick<FileTreeNode, 'path' | 'name' | 'is_dir'>;

/**
 * Whether `entry` can be dropped into `targetParentPath`. Only blocks
 * genuinely invalid moves (a folder into itself or its own descendant).
 * Dropping something back where it already lives is treated as *valid* —
 * it's a harmless no-op, not an error, so the cursor shouldn't show
 * "not allowed" for it. `move()` short-circuits that case itself.
 */
export function canMove(
  entry: MovableEntry,
  targetParentPath: string,
): boolean {
  if (entry.is_dir) {
    const separator = entry.path.includes('\\') ? '\\' : '/';
    const normalized = entry.path.endsWith(separator)
      ? entry.path
      : `${entry.path}${separator}`;
    // Can't move a folder into itself or one of its own descendants.
    if (
      targetParentPath === entry.path ||
      targetParentPath.startsWith(normalized)
    ) {
      return false;
    }
  }

  return true;
}

function logFailure(operation: string, error: string) {
  console.error(`[file-operations] ${operation} failed:`, error);
}

async function createFile(parentPath: string, name: string) {
  const path = joinPath(parentPath, name);
  const result = await commands.createFile(path);

  if (result.status === 'error') {
    logFailure(`create file "${path}"`, result.error);
    return result;
  }

  // `create_file` leaves a zero-byte file, which not every format can read back
  // as an empty document -- `""` is not JSON. The preset is looked up from the
  // extension rather than passed in, so typing `board.canvas` into the plain
  // new-file input seeds it exactly as the New Canvas menu item does.
  //
  // Before `openFile`, so the tab never opens on the empty version.
  const preset = getPresetByExtension(getFileExtension(name));
  if (preset?.initialContents) {
    const seeded = await commands.writeFile(path, preset.initialContents);
    if (seeded.status === 'error') {
      logFailure(`seed file "${path}"`, seeded.error);
    }
  }

  await applyFsChanges([selfChange('Created', path)]);
  useLayout.getState().openFile(path, name);
  return result;
}

async function createFolder(parentPath: string, name: string) {
  const path = joinPath(parentPath, name);
  const result = await commands.createDirectory(path);

  if (result.status === 'error') {
    logFailure(`create folder "${path}"`, result.error);
    return result;
  }

  await applyFsChanges([selfChange('Created', path, { isDir: true })]);
  return result;
}

async function rename(path: string, newName: string) {
  const parentPath = parentOf(path);
  const newPath = joinPath(parentPath, newName);
  const result = await commands.renamePath(path, newPath);

  if (result.status === 'error') {
    logFailure(`rename "${path}" to "${newPath}"`, result.error);
    return result;
  }

  await applyFsChanges([selfChange('Renamed', newPath, { from: path })]);
  return result;
}

async function move(entry: MovableEntry, targetParentPath: string) {
  if (!canMove(entry, targetParentPath)) {
    logFailure(
      `move "${entry.path}"`,
      `"${targetParentPath}" is not a valid destination`,
    );
    return { status: 'error', error: 'Invalid destination' } as const;
  }

  const currentParent = parentOf(entry.path);
  if (currentParent === targetParentPath) {
    return; // already there — nothing to do
  }

  const newPath = joinPath(targetParentPath, entry.name);
  const result = await commands.renamePath(entry.path, newPath);

  if (result.status === 'error') {
    logFailure(`move "${entry.path}" to "${newPath}"`, result.error);
    return result;
  }

  await applyFsChanges([
    selfChange('Renamed', newPath, { from: entry.path, isDir: entry.is_dir }),
  ]);

  return result;
}

/**
 * Deletion goes to the OS trash rather than unlinking, so a misclick is
 * recoverable from Finder/Explorer -- there is no in-app undo for it. The
 * tree sees a plain `Removed` either way; where the bytes went is the OS's
 * business, not the reconciler's.
 */
async function remove(node: Pick<FileTreeNode, 'path'>) {
  const result = await commands.trashPath(node.path);

  if (result.status === 'error') {
    logFailure(`delete "${node.path}"`, result.error);
    return result;
  }

  await applyFsChanges([selfChange('Removed', node.path)]);

  return result;
}

async function duplicate(entry: Pick<FileTreeNode, 'path' | 'is_dir'>) {
  const result = await commands.duplicatePath(entry.path);

  if (result.status === 'error') {
    logFailure(`duplicate "${entry.path}"`, result.error);
    return result;
  }

  // The backend picks the free name, so the path only exists once it answers.
  await applyFsChanges([
    selfChange('Created', result.data, { isDir: entry.is_dir }),
  ]);

  return result;
}

export const fileOperations = {
  createFile,
  createFolder,
  rename,
  remove,
  move,
  duplicate,
};
