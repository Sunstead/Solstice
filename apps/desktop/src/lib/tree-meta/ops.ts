import type { BookmarkEntry, TreeMetaOp, TreeMetaState } from '@/bindings';
import { normalizeHex } from '@/lib/workspace/color';

/**
 * A workspace's bookmarks and folder colors, by vault path (relative,
 * `/`-separated). `applyOps` is `solstice_sync::tree_meta::apply` without
 * the order keys, so the app can show a change before the backend answers;
 * both run `crates/solstice-sync/tests/tree_meta_ops.json`, so change both.
 */
export interface TreeMetaData {
  /** In order. */
  bookmarks: BookmarkEntry[];
  /** Folder path → `#rrggbb`. */
  folderColors: Record<string, string>;
}

export const EMPTY_TREE_META: TreeMetaData = { bookmarks: [], folderColors: {} };

export function fromState(state: TreeMetaState): TreeMetaData {
  return { bookmarks: state.bookmarks, folderColors: { ...state.folder_colors } };
}

/** `VaultPath::parse` and not hidden, as `checked` in `vault.rs`; throws otherwise. */
function checked(raw: string): string {
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(raw)) throw new Error(`bad path: ${raw}`);
  const unified = raw.replace(/\\/g, '/');
  if (unified.startsWith('/') || /^[a-z]:/i.test(unified)) throw new Error(`bad path: ${raw}`);
  const segments = unified.split('/').filter(Boolean);
  if (segments.length === 0 || segments.some((s) => s === '.' || s === '..')) throw new Error(`bad path: ${raw}`);
  if (segments.some((s) => s.startsWith('.'))) throw new Error(`${raw} is hidden`);
  return segments.join('/');
}

const isBookmarkId = (id: string) => /^[A-Za-z0-9-]{1,64}$/.test(id);

/** `path` with `from` swapped for `to`, if it is `from` or under it. */
export function retargetPath(path: string, from: string, to: string): string | null {
  if (path === from) return to;
  return path.startsWith(`${from}/`) ? `${to}${path.slice(from.length)}` : null;
}

const within = (path: string, folder: string) => retargetPath(path, folder, folder) !== null;

export function applyOps(meta: TreeMetaData, ops: TreeMetaOp[]): TreeMetaData {
  let bookmarks = [...meta.bookmarks];
  let folderColors = { ...meta.folderColors };
  for (const op of ops) {
    switch (op.op) {
      case 'add_bookmark': {
        if (!isBookmarkId(op.id)) throw new Error(`not a bookmark id: ${op.id}`);
        const path = checked(op.path);
        if (!bookmarks.some((b) => b.path === path || b.id === op.id)) bookmarks.push({ id: op.id, path });
        break;
      }
      case 'remove_bookmark': {
        const path = checked(op.path);
        bookmarks = bookmarks.filter((b) => b.path !== path);
        break;
      }
      case 'move_bookmark': {
        const from = bookmarks.findIndex((b) => b.id === op.id);
        if (from === -1) break;
        const [moved] = bookmarks.splice(from, 1);
        const after = op.after === null ? -1 : bookmarks.findIndex((b) => b.id === op.after);
        const to = op.after === null ? 0 : after === -1 ? bookmarks.length : after + 1;
        bookmarks.splice(to, 0, moved);
        break;
      }
      case 'set_folder_color': {
        const path = checked(op.path);
        if (op.color === null) {
          delete folderColors[path];
        } else {
          const hex = normalizeHex(op.color);
          if (!hex) throw new Error(`not a color: ${op.color}`);
          folderColors[path] = hex;
        }
        break;
      }
      case 'retarget': {
        const [from, to] = [checked(op.from), checked(op.to)];
        bookmarks = bookmarks.map((b) => {
          const path = retargetPath(b.path, from, to);
          return path === null ? b : { ...b, path };
        });
        folderColors = Object.fromEntries(
          Object.entries(folderColors).map(([p, c]) => [retargetPath(p, from, to) ?? p, c]),
        );
        break;
      }
      case 'forget': {
        const path = checked(op.path);
        bookmarks = bookmarks.filter((b) => !within(b.path, path));
        folderColors = Object.fromEntries(Object.entries(folderColors).filter(([p]) => !within(p, path)));
        break;
      }
    }
  }
  return { bookmarks, folderColors };
}

/** A path in the workspace `root` as a vault path; null for the root itself or outside it. */
export function toRel(root: string, abs: string): string | null {
  const r = root.replace(/\\/g, '/').replace(/\/+$/, '');
  const a = abs.replace(/\\/g, '/').replace(/\/+$/, '');
  return a.startsWith(`${r}/`) ? a.slice(r.length + 1) : null;
}

/** A vault path back in the workspace `root`, with the root's separators. */
export function toAbs(root: string, rel: string): string {
  const sep = root.includes('\\') ? '\\' : '/';
  const base = root.endsWith(sep) ? root.slice(0, -1) : root;
  return `${base}${sep}${rel.split('/').join(sep)}`;
}
