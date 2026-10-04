/**
 * The web app's view of the server: the user's vaults, the open one's file
 * tree, and a socket that says when it changes. A vault is a workspace whose
 * path is `/<vault name>`, so paths look like `/Notes/plans/Plan.md`; the
 * part after the vault is what the server calls a vault path.
 */
import type { FileEntry, FileSystemChanged, FsChange, SyncChanged } from '@/bindings';
import { apiJson, encodePath, signIn } from './api';
import { Emitter } from './emitter';

export interface Vault {
  id: string;
  name: string;
}

interface TreeFile {
  path: string;
  kind: 'note' | 'file';
  size: number;
  modified: number;
}

interface Tree {
  files: TreeFile[];
  folders: string[];
}

export type SocketState = 'connecting' | 'synced' | 'offline';

export const fsChanged = new Emitter<FileSystemChanged>();
export const syncChanged = new Emitter<SyncChanged>();

let vaultList: Vault[] | null = null;
let current: Vault | null = null;
let tree: Tree | null = null;
let treeLoad: Promise<Tree> | null = null;
let socket: WebSocket | null = null;
let socketState: SocketState = 'offline';
let retry: ReturnType<typeof setTimeout> | null = null;
let backoff = 1000;

export function rootOf(vault: Vault): string {
  return `/${vault.name}`;
}

export async function vaults(refresh = false): Promise<Vault[]> {
  if (!vaultList || refresh) vaultList = await apiJson<Vault[]>('/v1/vaults');
  return vaultList;
}

/** A new, empty vault on the server: the web app's new workspace. */
export async function createVault(name: string): Promise<Vault> {
  const vault = await apiJson<Vault>('/v1/vaults', { method: 'POST', json: { name } });
  vaultList = null;
  return vault;
}

/** A vault by name, from what's already loaded (for synchronous callers). */
export function knownVault(name: string): Vault | undefined {
  if (current?.name === name) return current;
  return vaultList?.find((v) => v.name === name);
}

export function currentVault(): Vault | null {
  return current;
}

export function currentSocketState(): SocketState {
  return socketState;
}

/** A path, split into its vault and the vault path inside it. */
export async function resolve(path: string): Promise<{ vault: Vault; rel: string }> {
  const clean = path.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
  const [name, ...rest] = clean.split('/');
  const vault =
    (current && current.name === name ? current : null) ??
    (await vaults()).find((v) => v.name === name) ??
    (await vaults(true)).find((v) => v.name === name);
  if (!vault) throw new Error(`There's no vault called ${name}.`);
  return { vault, rel: rest.join('/') };
}

export function vaultUrl(vault: Vault, route: string, rel = ''): string {
  const base = `/v1/vaults/${encodeURIComponent(vault.id)}/${route}`;
  return rel ? `${base}/${encodePath(rel)}` : base;
}

/** Opens a vault: its tree, and the socket that keeps it current. */
export async function open(path: string): Promise<void> {
  const { vault } = await resolve(path);
  if (current?.id !== vault.id) {
    current = vault;
    tree = null;
    treeLoad = null;
    connect();
  }
  await loadTree();
}

async function loadTree(force = false): Promise<Tree> {
  if (!current) throw new Error('No vault is open.');
  if (tree && !force) return tree;
  if (!treeLoad || force) {
    const vault = current;
    treeLoad = apiJson<Tree>(vaultUrl(vault, 'tree')).then((t) => {
      if (current?.id === vault.id) tree = t;
      return t;
    });
    treeLoad.finally(() => {
      treeLoad = null;
    });
  }
  return treeLoad;
}

/** The tree of the vault `path` is in (loading it if that's not the open one). */
async function treeFor(path: string): Promise<{ vault: Vault; rel: string; tree: Tree }> {
  const { vault, rel } = await resolve(path);
  const t = current?.id === vault.id ? await loadTree() : await apiJson<Tree>(vaultUrl(vault, 'tree'));
  return { vault, rel, tree: t };
}

function entry(vault: Vault, rel: string, isDir: boolean): FileEntry {
  return {
    name: rel.split('/').pop() ?? rel,
    path: `${rootOf(vault)}/${rel}`,
    is_dir: isDir,
  };
}

/** Every folder in a tree, those only implied by a file's path included. */
function allFolders(t: Tree): Set<string> {
  const folders = new Set(t.folders);
  for (const f of t.files) {
    const parts = f.path.split('/');
    for (let i = 1; i < parts.length; i++) folders.add(parts.slice(0, i).join('/'));
  }
  return folders;
}

export async function listDirectory(path: string): Promise<FileEntry[]> {
  const { vault, rel, tree: t } = await treeFor(path);
  const prefix = rel ? `${rel}/` : '';
  const isChild = (p: string) => p.startsWith(prefix) && !p.slice(prefix.length).includes('/');
  return [
    ...[...allFolders(t)].filter(isChild).map((p) => entry(vault, p, true)),
    ...t.files.filter((f) => isChild(f.path)).map((f) => entry(vault, f.path, false)),
  ];
}

export async function listRecursive(path: string): Promise<FileEntry[]> {
  const { vault, rel, tree: t } = await treeFor(path);
  const prefix = rel ? `${rel}/` : '';
  return [
    ...[...allFolders(t)].filter((p) => p.startsWith(prefix)).map((p) => entry(vault, p, true)),
    ...t.files.filter((f) => f.path.startsWith(prefix)).map((f) => entry(vault, f.path, false)),
  ];
}

export async function exists(path: string): Promise<boolean> {
  try {
    const { rel, tree: t } = await treeFor(path);
    if (!rel) return true;
    return t.files.some((f) => f.path === rel) || allFolders(t).has(rel);
  } catch {
    return false;
  }
}

/** After a change the app made itself: bring the tree up to date now. */
export async function refresh(): Promise<void> {
  if (current) await applyTreeChange([]);
}

// ---------------------------------------------------------------- socket

function connect() {
  if (retry) clearTimeout(retry);
  retry = null;
  socket?.close();
  const vault = current;
  if (!vault) return;
  setSocketState('connecting');
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const ws = new WebSocket(`${proto}//${location.host}/v1/web/events?vault=${encodeURIComponent(vault.id)}`);
  socket = ws;
  ws.onopen = () => {
    backoff = 1000;
    setSocketState('synced');
    // Whatever changed while it was away.
    void applyTreeChange([]);
  };
  ws.onmessage = (e) => {
    let msg: { notice?: string; tree?: boolean; notes?: string[] };
    try {
      msg = JSON.parse(String(e.data));
    } catch {
      return;
    }
    if (msg.notice === 'signed_out') signIn();
    if (msg.tree || msg.notes?.length) void applyTreeChange(msg.notes ?? [], msg.tree);
  };
  ws.onclose = () => {
    if (socket !== ws) return;
    socket = null;
    setSocketState('offline');
    // The vault's task stops when idle, and servers restart: come back.
    retry = setTimeout(connect, backoff);
    backoff = Math.min(backoff * 2, 30_000);
  };
}

export function reconnect() {
  backoff = 1000;
  connect();
}

function setSocketState(state: SocketState) {
  socketState = state;
  if (current) syncChanged.emit({ root: rootOf(current) });
}

/**
 * Turns a change on the server into the watcher events the app already
 * handles: the tree is fetched again and compared, and notes whose text
 * changed are reported as modified.
 */
async function applyTreeChange(notes: string[], treeChanged = true) {
  const vault = current;
  if (!vault) return;
  const before = tree;
  const after = treeChanged || !before ? await loadTree(true) : before;
  if (current?.id !== vault.id) return;
  const changes: FsChange[] = [];
  const abs = (rel: string) => `${rootOf(vault)}/${rel}`;
  if (before) {
    const oldFiles = new Map(before.files.map((f) => [f.path, f]));
    const newFiles = new Map(after.files.map((f) => [f.path, f]));
    const oldDirs = allFolders(before);
    const newDirs = allFolders(after);
    for (const [p] of oldFiles) {
      if (!newFiles.has(p)) changes.push({ kind: 'Removed', path: abs(p), from: null, entry: null });
    }
    for (const p of oldDirs) {
      if (!newDirs.has(p)) changes.push({ kind: 'Removed', path: abs(p), from: null, entry: null });
    }
    for (const p of newDirs) {
      if (!oldDirs.has(p)) changes.push({ kind: 'Created', path: abs(p), from: null, entry: entry(vault, p, true) });
    }
    for (const [p, f] of newFiles) {
      const old = oldFiles.get(p);
      if (!old) {
        changes.push({ kind: 'Created', path: abs(p), from: null, entry: entry(vault, p, false) });
      } else if (f.kind === 'file' && (old.size !== f.size || old.modified !== f.modified)) {
        changes.push({ kind: 'Modified', path: abs(p), from: null, entry: entry(vault, p, false) });
      }
    }
  }
  for (const p of notes) {
    if (after.files.some((f) => f.path === p)) {
      changes.push({ kind: 'Modified', path: abs(p), from: null, entry: entry(vault, p, false) });
    }
  }
  if (changes.length > 0) fsChanged.emit({ root: rootOf(vault), changes });
  if (treeChanged) syncChanged.emit({ root: rootOf(vault) });
}
