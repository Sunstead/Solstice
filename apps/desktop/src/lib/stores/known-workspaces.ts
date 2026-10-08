import { create } from 'zustand';
import { commands } from '@/lib/backend';
import { shell } from '@/lib/backend/platform';
import { load } from '@/lib/backend/store';

export interface KnownWorkspace {
  path: string;
  name: string;
  lastOpenedAt: number;
}

const STORE_FILE = 'known-workspaces.json';
const STORE_KEY = 'workspaces';
/** Where the last new workspace was made, offered for the next one. */
const PARENT_KEY = 'lastParent';

function getStore() {
  return load(STORE_FILE, { autoSave: true });
}

function nameFromPath(path: string) {
  return path.split(/[\\/]/).pop() ?? path;
}

/**
 * The path `path` has now, on a phone. iOS moves an app's container (its
 * path names a new id) when it's reinstalled or updated, so a workspace
 * saved under the old Documents is looked for under the current one.
 */
export function rerooted(path: string, documents: string | null): string {
  const at = path.lastIndexOf('/Documents/');
  if (!documents || at === -1) return path;
  return documents.replace(/\/$/, '') + path.slice(at + '/Documents'.length);
}

interface KnownWorkspacesState {
  workspaces: KnownWorkspace[];
  load: () => Promise<void>;
  touch: (path: string) => Promise<void>;
  /** Drops a workspace from the list; its folder is untouched. */
  forget: (path: string) => Promise<void>;
  lastParent: () => Promise<string | null>;
  rememberParent: (parent: string) => Promise<void>;
}

export const useKnownWorkspaces = create<KnownWorkspacesState>((set) => ({
  workspaces: [],

  load: async () => {
    const store = await getStore();
    let workspaces = (await store.get<KnownWorkspace[]>(STORE_KEY)) ?? [];
    if (shell === 'mobile') {
      const documents = await commands.defaultWorkspaceParent();
      const moved = workspaces.map((w) => ({ ...w, path: rerooted(w.path, documents) }));
      if (moved.some((w, i) => w.path !== workspaces[i].path)) {
        workspaces = moved;
        await store.set(STORE_KEY, workspaces);
      }
    }
    set({ workspaces });
  },

  touch: async (path) => {
    const store = await getStore();
    const list = (await store.get<KnownWorkspace[]>(STORE_KEY)) ?? [];
    const workspaces = [
      { path, name: nameFromPath(path), lastOpenedAt: Date.now() },
      ...list.filter((w) => w.path !== path),
    ];
    await store.set(STORE_KEY, workspaces);
    set({ workspaces });
  },

  forget: async (path) => {
    const store = await getStore();
    const list = (await store.get<KnownWorkspace[]>(STORE_KEY)) ?? [];
    const workspaces = list.filter((w) => w.path !== path);
    await store.set(STORE_KEY, workspaces);
    set({ workspaces });
  },

  lastParent: async () => (await (await getStore()).get<string>(PARENT_KEY)) ?? null,

  rememberParent: async (parent) => {
    await (await getStore()).set(PARENT_KEY, parent);
  },
}));
