import { load, type Store } from '@tauri-apps/plugin-store';
import { mkdir } from '@tauri-apps/plugin-fs';
import type { StateStorage } from 'zustand/middleware';
import { useWorkspace } from '@/hooks/use-workspace';

const WORKSPACE_DIR = '.solstice';
const storeCache = new Map<string, Promise<Store>>();

/** Where a store file lives: alongside the open workspace, or in app data. */
export type StoreScope = 'workspace' | 'global';

function normalize(path: string) {
  return path.replace(/\\/g, '/').replace(/\/$/, '');
}

function resolveTarget(fileName: string, scope: StoreScope) {
  const workspacePath =
    scope === 'workspace' ? useWorkspace.getState().path : null;

  if (workspacePath) {
    const dir = `${normalize(workspacePath)}/${WORKSPACE_DIR}`;
    return {
      cacheKey: `ws:${dir}/${fileName}`,
      dir,
      filePath: `${dir}/${fileName}`,
    };
  }

  // A bare filename resolves relative to the app data dir. Workspace-scoped
  // callers land here too when no workspace is open yet -- pass
  // `requireWorkspace` to opt out of that fallback instead.
  return { cacheKey: `global:${fileName}`, dir: null, filePath: fileName };
}

export async function getScopedStore(
  fileName: string,
  scope: StoreScope = 'workspace',
): Promise<Store> {
  const { cacheKey, dir, filePath } = resolveTarget(fileName, scope);

  let storePromise = storeCache.get(cacheKey);
  if (!storePromise) {
    storePromise = (async () => {
      if (dir) await mkdir(dir, { recursive: true }).catch(() => {});
      return load(filePath, { autoSave: true });
    })();
    storeCache.set(cacheKey, storePromise);
  }

  return storePromise;
}

/** True when a workspace-scoped store would currently resolve to a workspace. */
export function hasOpenWorkspace() {
  return useWorkspace.getState().path !== null;
}

/**
 * Drop cached handles and call whenever the active workspace changes. Only
 * the workspace-scoped handles are dropped: `global:` entries point at the
 * app data dir, which does not move, and dropping them would race any write
 * still in flight.
 */
export function resetScopedStoreCache() {
  for (const key of storeCache.keys()) {
    if (key.startsWith('ws:')) storeCache.delete(key);
  }
}

interface ScopedStorageOptions {
  /**
   * Refuse to fall back to the app data dir when no workspace is open.
   * Reads return null and writes are dropped instead. Use this for data that
   * is meaningless without a workspace -- otherwise it would be written to
   * app data and then collide with a genuinely global store of the same name.
   */
  requireWorkspace?: boolean;
}

/**
 * A zustand StateStorage backed by `<workspace>/.solstice/<fileName>` when a
 * workspace is open, or the app data dir otherwise. The zustand `name` (e.g.
 * "workspace-ui") is the single key inside that file.
 */
export function createScopedStorage(
  fileName: string,
  { requireWorkspace = false }: ScopedStorageOptions = {},
): StateStorage {
  const unavailable = () => requireWorkspace && !hasOpenWorkspace();

  return {
    getItem: async (name) => {
      if (unavailable()) return null;
      const store = await getScopedStore(fileName);
      const value = await store.get(name);
      return value ? JSON.stringify(value) : null;
    },
    setItem: async (name, value) => {
      if (unavailable()) return;
      const store = await getScopedStore(fileName);
      await store.set(name, JSON.parse(value));
    },
    removeItem: async (name) => {
      if (unavailable()) return;
      const store = await getScopedStore(fileName);
      await store.delete(name);
    },
  };
}

/**
 * A zustand StateStorage that always resolves to the app data dir, whether or
 * not a workspace is open. The counterpart to `createScopedStorage`.
 */
export function createGlobalStorage(fileName: string): StateStorage {
  return {
    getItem: async (name) => {
      const store = await getScopedStore(fileName, 'global');
      const value = await store.get(name);
      return value ? JSON.stringify(value) : null;
    },
    setItem: async (name, value) => {
      const store = await getScopedStore(fileName, 'global');
      await store.set(name, JSON.parse(value));
    },
    removeItem: async (name) => {
      const store = await getScopedStore(fileName, 'global');
      await store.delete(name);
    },
  };
}
