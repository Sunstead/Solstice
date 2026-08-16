import { commands } from '@/bindings';
import { useFiles } from '@/hooks/use-files';
import type { FileTreeNode } from '@/hooks/use-files';
import { useLayout } from '@/hooks/use-layout';

function joinPath(parentPath: string, name: string): string {
  const separator = parentPath.includes('\\') ? '\\' : '/';
  return parentPath.endsWith(separator)
    ? `${parentPath}${name}`
    : `${parentPath}${separator}${name}`;
}

function parentOf(path: string): string {
  const separator = path.includes('\\') ? '\\' : '/';
  const index = path.lastIndexOf(separator);
  return index === -1 ? '' : path.slice(0, index);
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
  return result;
}

export const fileOperations = {
  createFile,
  createFolder,
  rename,
  remove,
};
