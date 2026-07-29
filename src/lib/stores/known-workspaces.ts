import { load } from '@tauri-apps/plugin-store';

interface KnownWorkspace {
  path: string;
  name: string;
  lastOpenedAt: number;
}

export async function touchKnownWorkspace(path: string) {
  const store = await load('known-workspaces.json', { autoSave: true });
  const list = (await store.get<KnownWorkspace[]>('workspaces')) ?? [];
  const name = path.split(/[\\/]/).pop() ?? path;
  const next = [
    { path, name, lastOpenedAt: Date.now() },
    ...list.filter((w) => w.path !== path),
  ];
  await store.set('workspaces', next);
}
