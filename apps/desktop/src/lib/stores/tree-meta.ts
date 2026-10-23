import { useEffect } from 'react';
import { create } from 'zustand';

import type { FsChange, TreeMetaOp, TreeMetaState } from '@/bindings';
import { commands, events } from '@/lib/backend';
import { useWorkspace } from '@/hooks/use-workspace';
import { applyOps, EMPTY_TREE_META, fromState, toRel, type TreeMetaData } from '@/lib/tree-meta/ops';
import { opsFromWatcher } from '@/lib/tree-meta/watcher';

/**
 * The open workspace's bookmarks and folder colors. The backend keeps them
 * (`tree_meta.rs`: `.solstice/tree.json`, or the vault when it syncs); this
 * shows each change at once and sends them one at a time, so what's shown is
 * always the backend's last answer with the changes still on their way laid
 * over it. Paths in and out are the workspace's own (absolute).
 */
interface TreeMetaStore {
  root: string | null;
  /** Kept in the vault, so other devices change it too. */
  linked: boolean;
  meta: TreeMetaData;
  load: (root: string) => Promise<void>;
  reset: () => void;
  /** Applies `ops`; the error, if the backend refused them. */
  apply: (ops: TreeMetaOp[]) => Promise<string | null>;
  isBookmarked: (path: string) => boolean;
  folderColor: (path: string) => string | null;
  toggleBookmark: (path: string) => Promise<string | null>;
  setFolderColor: (path: string, color: string | null) => Promise<string | null>;
  /** A rename or move made in the app. */
  retarget: (from: string, to: string) => Promise<string | null>;
  /** A delete made in the app. */
  forget: (path: string) => Promise<string | null>;
  /** Renames the file watcher saw (see `opsFromWatcher`). */
  fromWatcher: (changes: FsChange[]) => void;
}

/** What the backend last said, and the changes it hasn't answered yet. */
let confirmed: TreeMetaData = EMPTY_TREE_META;
let pending: TreeMetaOp[][] = [];
let sending: Promise<unknown> = Promise.resolve();

function shown(): TreeMetaData {
  try {
    return applyOps(confirmed, pending.flat());
  } catch {
    return confirmed;
  }
}

export const useTreeMeta = create<TreeMetaStore>((set, get) => {
  const show = () => set({ meta: shown() });
  const adopt = (state: TreeMetaState) => {
    confirmed = fromState(state);
    set({ linked: state.linked });
  };
  const rel = (path: string) => {
    const root = get().root;
    return root ? toRel(root, path) : null;
  };

  return {
    root: null,
    linked: false,
    meta: EMPTY_TREE_META,

    load: async (root) => {
      if (get().root !== root) {
        confirmed = EMPTY_TREE_META;
        pending = [];
        sending = Promise.resolve();
        set({ root, linked: false, meta: EMPTY_TREE_META });
      }
      const result = await commands.treeMeta(root);
      if (get().root !== root) return;
      if (result.status === 'error') return console.warn('[tree-meta] not loaded:', result.error);
      adopt(result.data);
      show();
    },

    reset: () => {
      confirmed = EMPTY_TREE_META;
      pending = [];
      sending = Promise.resolve();
      set({ root: null, linked: false, meta: EMPTY_TREE_META });
    },

    apply: (ops) => {
      const root = get().root;
      if (!root || ops.length === 0) return Promise.resolve(null);
      try {
        applyOps(shown(), ops);
      } catch (error) {
        return Promise.resolve(String(error));
      }
      pending.push(ops);
      show();
      const sent = sending.then(async () => {
        const result = await commands.treeMetaApply(root, ops);
        if (get().root !== root) return null;
        pending = pending.filter((p) => p !== ops);
        if (result.status === 'ok') adopt(result.data);
        show();
        return result.status === 'error' ? result.error : null;
      });
      sending = sent.catch(() => {});
      return sent;
    },

    isBookmarked: (path) => {
      const r = rel(path);
      return r !== null && get().meta.bookmarks.some((b) => b.path === r);
    },

    folderColor: (path) => {
      const r = rel(path);
      return r === null ? null : (get().meta.folderColors[r] ?? null);
    },

    toggleBookmark: (path) => {
      const r = rel(path);
      if (r === null) return Promise.resolve(null);
      return get().apply([
        get().isBookmarked(path)
          ? { op: 'remove_bookmark', path: r }
          : { op: 'add_bookmark', id: crypto.randomUUID(), path: r },
      ]);
    },

    setFolderColor: (path, color) => {
      const r = rel(path);
      return r === null ? Promise.resolve(null) : get().apply([{ op: 'set_folder_color', path: r, color }]);
    },

    retarget: (from, to) => {
      const [f, t] = [rel(from), rel(to)];
      return f === null || t === null || f === t ? Promise.resolve(null) : get().apply([{ op: 'retarget', from: f, to: t }]);
    },

    forget: (path) => {
      const r = rel(path);
      return r === null ? Promise.resolve(null) : get().apply([{ op: 'forget', path: r }]);
    },

    fromWatcher: (changes) => {
      const { root, linked } = get();
      if (root) void get().apply(opsFromWatcher(changes, root, linked));
    },
  };
});

/**
 * Keeps the store on the open workspace: loaded when it opens, and again
 * whenever the backend says another window or device changed it, or sync
 * started (a linked folder's client starts a moment after it opens).
 */
export function useTreeMetaSync() {
  const workspace = useWorkspace((s) => s.path);

  useEffect(() => {
    if (!workspace) {
      useTreeMeta.getState().reset();
      return;
    }
    const reload = () => void useTreeMeta.getState().load(workspace);
    reload();
    const stops = [events.treeMetaChanged.listen(reload), events.syncChanged.listen(reload)];
    return () => {
      for (const stop of stops) void stop.then((s) => s());
    };
  }, [workspace]);
}
