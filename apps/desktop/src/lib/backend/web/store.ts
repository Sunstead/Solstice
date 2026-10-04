/**
 * The desktop keeps settings and app state in small JSON files; the web app
 * keeps the same objects on the server (`/v1/web/settings/{scope}`), so they
 * follow the user between browsers. A file in a workspace's `.solstice/`
 * maps to that vault's scope, anything else to a global one:
 *
 *   `settings.json`                     → `global.settings`
 *   `/Notes/.solstice/layout.json`      → `vault.<id>.layout`
 *
 * The workspace list is the user's vaults on the server, in the order they
 * were last opened here.
 */
import { apiJson } from './api';
import { resolve, rootOf, vaults } from './vault';

function stem(file: string) {
  return file
    .replace(/\.json$/i, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-');
}

async function scopeFor(path: string): Promise<string> {
  const clean = path.replace(/\\/g, '/');
  const at = clean.indexOf('/.solstice/');
  if (at === -1) return `global.${stem(clean.split('/').pop() ?? clean)}`;
  const { vault } = await resolve(clean.slice(0, at));
  return `vault.${vault.id}.${stem(clean.slice(at + '/.solstice/'.length))}`;
}

interface KnownWorkspace {
  path: string;
  name: string;
  lastOpenedAt: number;
}

const SAVE_AFTER_MS = 300;

/** One settings object, shaped like the Tauri store plugin's `Store`. */
export class WebStore {
  private data: Record<string, unknown> = {};
  private timer: ReturnType<typeof setTimeout> | null = null;

  private constructor(private readonly scope: string) {}

  static async load(path: string): Promise<WebStore> {
    const store = new WebStore(await scopeFor(path));
    store.data = await apiJson<Record<string, unknown>>(`/v1/web/settings/${store.scope}`);
    return store;
  }

  async get<T>(key: string): Promise<T | undefined> {
    if (this.scope === 'global.known-workspaces' && key === 'workspaces') {
      return (await this.workspaces()) as T;
    }
    return this.data[key] as T | undefined;
  }

  async set(key: string, value: unknown): Promise<void> {
    this.data[key] = value;
    this.schedule();
  }

  async delete(key: string): Promise<boolean> {
    const had = key in this.data;
    delete this.data[key];
    this.schedule();
    return had;
  }

  async has(key: string): Promise<boolean> {
    return key in this.data;
  }

  async entries<T>(): Promise<[string, T][]> {
    return Object.entries(this.data) as [string, T][];
  }

  async keys(): Promise<string[]> {
    return Object.keys(this.data);
  }

  async save(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    await apiJson(`/v1/web/settings/${this.scope}`, { method: 'PUT', json: this.data });
  }

  private schedule() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      void this.save().catch((e) => console.error('Failed to save settings:', e));
    }, SAVE_AFTER_MS);
  }

  /** Every vault on the server, most recently opened here first. */
  private async workspaces(): Promise<KnownWorkspace[]> {
    const opened = new Map(
      ((this.data.workspaces as KnownWorkspace[] | undefined) ?? []).map((w) => [w.path, w.lastOpenedAt]),
    );
    return (await vaults(true))
      .map((v) => ({ path: rootOf(v), name: v.name, lastOpenedAt: opened.get(rootOf(v)) ?? 0 }))
      .sort((a, b) => b.lastOpenedAt - a.lastOpenedAt || a.name.localeCompare(b.name));
  }
}
