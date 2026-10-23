import type { BookmarkEntry, FileEntry, TreeMetaOp } from '@/bindings';
import { normalizePath, parentPath } from '@/lib/path-utils';

/**
 * The bookmarks to show: those whose file or folder is there, once each.
 * One whose target was deleted elsewhere (or isn't downloaded yet) stays
 * stored and shows again if it comes back.
 */
export function visibleBookmarks(bookmarks: BookmarkEntry[], exists: (rel: string) => boolean): BookmarkEntry[] {
  const seen = new Set<string>();
  return bookmarks.filter((b) => {
    if (seen.has(b.path) || !exists(b.path)) return false;
    seen.add(b.path);
    return true;
  });
}

/**
 * Dragging the visible bookmark at `from` to `to`, as an op: after the
 * visible one it lands behind, so hidden ones keep their places. Null when
 * it lands where it was.
 */
export function moveOp(visible: BookmarkEntry[], from: number, to: number): TreeMetaOp | null {
  if (from === to || !visible[from]) return null;
  const order = visible.filter((_, i) => i !== from);
  order.splice(to, 0, visible[from]);
  return { op: 'move_bookmark', id: visible[from].id, after: to > 0 ? order[to - 1].id : null };
}

/**
 * A folder's entries from the workspace's file index, ordered and filtered
 * as the tree orders and filters them (`selectChildren`), for a bookmarked
 * folder opened in the Bookmarks view.
 */
export function childrenOf(
  index: FileEntry[],
  folder: string,
  { showHidden, foldersFirst }: { showHidden: boolean; foldersFirst: boolean },
): FileEntry[] {
  const parent = normalizePath(folder);
  return index
    .filter((e) => parentPath(e.path) === parent && (showHidden || !e.name.startsWith('.')))
    .sort(
      (a, b) =>
        (foldersFirst && a.is_dir !== b.is_dir ? (a.is_dir ? -1 : 1) : 0) ||
        a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }),
    );
}
