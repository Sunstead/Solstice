import { openPath, revealItemInDir } from '@/lib/backend/shell';

import type { FileTreeNode } from '@/hooks/use-files';
import { useFiles } from '@/hooks/use-files';
import { useLayout } from '@/hooks/use-layout';
import { useWorkspace } from '@/hooks/use-workspace';
import { fileOperations } from '@/lib/file-operations';
import {
  ancestorChain,
  getFileNameFromPath,
  getRelativePath,
  isSamePath,
} from '@/lib/path-utils';
import { useEntryInput } from '@/lib/stores/entry-input';
import { useFileActionDialog } from '@/lib/stores/file-action-dialog';
import { useFindStore } from '@/lib/stores/find';
import { useRevealTarget } from '@/lib/stores/reveal-target';
import { useWorkspaceUIStore } from '@/lib/stores/workspace-ui-store';
import {
  shortestWikilinkTarget,
  useWikilinkIndex,
} from '@/lib/stores/wikilink-index';
import { WIKILINK_CLOSE, WIKILINK_OPEN } from '@/lib/wikilink/target';

/**
 * The one implementation of every file/folder action, taking an explicit
 * target rather than reading an ambient selection. The editor's dropdown, the
 * explorer's context menu, the breadcrumb trail and the `file.*` commands all
 * come through here, so an action behaves identically however it was reached
 * -- the same reason `runCommand` unifies keybinds and native menu clicks.
 */

/** The minimum an action needs to know about what it is acting on. */
export type EntryTarget = Pick<FileTreeNode, 'path' | 'name' | 'is_dir'>;

/**
 * The tree's node for `path` when it has one, or a stand-in when it does not.
 * Callers that only hold a path -- the editor header, a `file.*` command --
 * still need a target, and what they address is always an open file, so the
 * stand-in's `is_dir: false` is right for every case that reaches it.
 */
export function targetFromPath(path: string): EntryTarget {
  const { entries } = useFiles.getState();

  // Store keys carry the OS's own separators, but a breadcrumb crumb hands us
  // a normalized path -- so a direct hit is the fast path, not the only one.
  const node =
    entries[path] ??
    Object.values(entries).find((entry) => isSamePath(entry.path, path));

  if (node) return node;

  return { path, name: getFileNameFromPath(path), is_dir: false };
}

function logFailure(action: string, error: unknown) {
  console.error(`[entry-actions] ${action} failed:`, error);
}

async function copyText(action: string, text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch (error) {
    logFailure(action, error);
  }
}

/**
 * Brings `path` into view in the explorer: switches to it, opens the sidebar
 * if it was collapsed, expands every folder above the entry, then marks it for
 * the transient highlight. Expansion is sequential by necessity -- a folder's
 * children only enter the store once its parent has been read.
 */
export async function revealInExplorer(path: string) {
  const root = useWorkspace.getState().path;
  if (!root) return;

  useWorkspaceUIStore.getState().setActivePrimaryView('explorer');
  useWorkspaceUIStore.getState().setSidebarCollapsed(false);

  for (const directory of ancestorChain(root, path)) {
    await useFiles.getState().expandDirectory(directory);
  }

  // Revealing a folder should open it, not just point at it.
  if (targetFromPath(path).is_dir && !isSamePath(path, root)) {
    await useFiles.getState().expandDirectory(path);
  }

  useRevealTarget.getState().reveal(path);
}

export async function revealInSystem(path: string) {
  try {
    await revealItemInDir(path);
  } catch (error) {
    logFailure(`reveal "${path}" in the system file manager`, error);
  }
}

export async function openInDefaultApp(path: string) {
  try {
    await openPath(path);
  } catch (error) {
    logFailure(`open "${path}" in its default app`, error);
  }
}

export function copyAbsolutePath(path: string) {
  return copyText(`copy absolute path of "${path}"`, path);
}

export function copyRelativePath(path: string) {
  const root = useWorkspace.getState().path;

  return copyText(
    `copy relative path of "${path}"`,
    root ? getRelativePath(path, root) : path,
  );
}

/**
 * The link form the wikilink autocomplete would have inserted for this file,
 * so a copied link and a typed one are the same string.
 */
export function wikilinkFor(path: string): string {
  const root = useWorkspace.getState().path;
  const relative = root ? getRelativePath(path, root) : getFileNameFromPath(path);
  const target = shortestWikilinkTarget(relative, useWikilinkIndex.getState());

  return `${WIKILINK_OPEN}${target}${WIKILINK_CLOSE}`;
}

export function copyWikilink(path: string) {
  return copyText(`copy wikilink for "${path}"`, wikilinkFor(path));
}

export function openInNewTab(path: string) {
  useLayout.getState().openFileInNewTab(path, getFileNameFromPath(path));
}

export function openToTheSide(path: string) {
  useLayout.getState().openFileInNewTab(path, getFileNameFromPath(path), 'right');
}

export function find(path: string) {
  useFindStore.getState().openFor(path);
}

/**
 * Rename always happens in the explorer's inline input -- there is exactly one
 * rename affordance in the app, and invoking it from the editor should land
 * the caret in the same place invoking it from the tree does. That means the
 * row has to exist and be on screen first, hence the awaited reveal.
 */
export async function startRename(path: string) {
  await revealInExplorer(path);
  useEntryInput.getState().startRename(targetFromPath(path));
}

export function duplicate(path: string) {
  return fileOperations.duplicate(targetFromPath(path));
}

export function requestMove(path: string) {
  const target = targetFromPath(path);
  const node = useFiles.getState().entries[target.path];

  useFileActionDialog.getState().requestMove(
    node ?? { ...target, childrenLoaded: false, expanded: false },
  );
}

export function requestDelete(path: string) {
  const target = targetFromPath(path);
  const node = useFiles.getState().entries[target.path];

  useFileActionDialog.getState().requestDelete(
    node ?? { ...target, childrenLoaded: false, expanded: false },
  );
}
