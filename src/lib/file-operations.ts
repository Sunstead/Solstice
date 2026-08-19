import { commands } from '@/bindings';
import { useFiles } from '@/hooks/use-files';
import type { FileTreeNode } from '@/hooks/use-files';
import { useLayout } from '@/hooks/use-layout';
import { useWorkspace } from '@/hooks/use-workspace';
import { useFileIndex } from '@/lib/stores/use-file-index';

function joinPath(parentPath: string, name: string): string {
  const separator = parentPath.includes('\\') ? '\\' : '/';
  return parentPath.endsWith(separator)
    ? `${parentPath}${name}`
    : `${parentPath}${separator}${name}`;
}

export function parentOf(path: string): string {
  const separator = path.includes('\\') ? '\\' : '/';
  const index = path.lastIndexOf(separator);
  return index === -1 ? '' : path.slice(0, index);
}

/**
 * The flat search index (`useFileIndex`) has no per-directory expand/collapse
 * state to reconcile — unlike `useFiles`, a surgical patch after a folder
 * rename/move would need to rewrite every descendant path by hand. A full
 * re-walk is simpler, still cheap (these operations are user-triggered, not
 * hot-path), and can't drift the way a partial patch could.
 */
async function refreshFileIndex() {
  const root = useWorkspace.getState().path;
  if (root) {
    await useFileIndex.getState().loadIndex(root);
  }
}

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

  await useFiles.getState().refreshDirectory(parentPath);
  await refreshFileIndex();
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

  await useFiles.getState().refreshDirectory(parentPath);
  await refreshFileIndex();
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

  useFiles.getState().removeSubtree(path);
  await useFiles.getState().refreshDirectory(parentPath);
  await refreshFileIndex();
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

  useFiles.getState().removeSubtree(entry.path);
  await Promise.all([
    useFiles.getState().refreshDirectory(currentParent),
    useFiles.getState().refreshDirectory(targetParentPath),
  ]);
  await refreshFileIndex();

  return result;
}

async function remove(node: FileTreeNode) {
  const result = node.is_dir
    ? await commands.deleteDirectory(node.path, true)
    : await commands.deleteFile(node.path);

  if (result.status === 'error') {
    logFailure(`delete "${node.path}"`, result.error);
    return result;
  }

  useFiles.getState().removeSubtree(node.path);
  await refreshFileIndex();

  if (node.is_dir) {
    useLayout.getState().closeFolderTabs(node.path);
  } else {
    useLayout.getState().closeFileTab(node.path);
  }

  return result;
}

export const fileOperations = {
  createFile,
  createFolder,
  rename,
  remove,
  move,
};
