import { load, type Store } from '@tauri-apps/plugin-store';
import { mkdir } from '@tauri-apps/plugin-fs';
import type { StateStorage } from 'zustand/middleware';
import { useWorkspace } from '@/hooks/use-workspace';

const WORKSPACE_DIR = '.solstice';
const storeCache = new Map<string, Promise<Store>>();

function normalize(path: string) {
  return path.replace(/\\/g, '/').replace(/\/$/, '');
}

function resolveTarget(fileName: string) {
  const workspacePath = useWorkspace.getState().path;

  if (workspacePath) {
    const dir = `${normalize(workspacePath)}/${WORKSPACE_DIR}`;
    return {
      cacheKey: `ws:${dir}/${fileName}`,
      dir,
      filePath: `${dir}/${fileName}`,
    };
  }

  // No workspace open yet, so bare filename resolves relative to the app data dir.
  return { cacheKey: `global:${fileName}`, dir: null, filePath: fileName };
}

export async function getScopedStore(fileName: string): Promise<Store> {
  const { cacheKey, dir, filePath } = resolveTarget(fileName);

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

/** Drop cached handles and call whenever the active workspace changes. */
export function resetScopedStoreCache() {
  storeCache.clear();
}

/**
 * A zustand StateStorage backed by `<workspace>/.solstice/<fileName>` when a
 * workspace is open, or the app data dir otherwise. The zustand `name` (e.g.
 * "workspace-ui") is the single key inside that file.
 */
export function createScopedStorage(fileName: string): StateStorage {
  return {
    getItem: async (name) => {
      const store = await getScopedStore(fileName);
      const value = await store.get(name);
      return value ? JSON.stringify(value) : null;
    },
    setItem: async (name, value) => {
      const store = await getScopedStore(fileName);
      await store.set(name, JSON.parse(value));
    },
    removeItem: async (name) => {
      const store = await getScopedStore(fileName);
      await store.delete(name);
    },
  };
}
