/**
 * The web app's backend: every command the desktop's Rust side answers,
 * answered by the Solstice Sync server instead (`apps/sync/src/web_api.rs`).
 * Notes are read with a `base` and saved against it, so the server merges a
 * save into whatever other devices did since. What only makes sense on a
 * computer (theme folders, system fonts, linking a folder to sync) says so.
 */
import type {
  CommandId,
  CommandMeta,
  ResolvedMenu,
  ResolvedMenuEntry,
  SyncInfo,
  SyncReview,
  SyncVersions,
} from '@/bindings';
import type { Commands } from '../index';
import registry from '../registry.json';
import { api, apiJson, ApiError, messageOf } from './api';
import { Emitter } from './emitter';
import { attachmentName } from './shell';
import {
  currentSocketState,
  currentVault,
  exists,
  fsChanged,
  listDirectory,
  listRecursive,
  open,
  reconnect,
  refresh,
  resolve,
  rootOf,
  vaultUrl,
} from './vault';

type Result<T> = { status: 'ok'; data: T } | { status: 'error'; error: string };

async function attempt<T>(run: () => Promise<T>): Promise<Result<T>> {
  try {
    return { status: 'ok', data: await run() };
  } catch (error) {
    return { status: 'error', error: messageOf(error) };
  }
}

const desktopOnly = (what: string) =>
  Promise.resolve<Result<never>>({ status: 'error', error: `${what} is only in the desktop app.` });

const isNote = (path: string) => path.toLowerCase().endsWith('.md');

/** Where each open note's text was when it was read: its saves go against it. */
const bases = new Map<string, string>();

interface NoteReply {
  path: string;
  text: string;
  base: string;
}

async function readNote(path: string): Promise<string> {
  const { vault, rel } = await resolve(path);
  const note = await apiJson<NoteReply>(vaultUrl(vault, 'notes', rel));
  bases.set(path, note.base);
  return note.text;
}

async function writeNote(path: string, text: string): Promise<void> {
  const { vault, rel } = await resolve(path);
  try {
    const note = await apiJson<NoteReply>(vaultUrl(vault, 'notes', rel), {
      method: 'PUT',
      json: { text, base: bases.get(path) ?? null },
    });
    bases.set(path, note.base);
  } catch (error) {
    if (error instanceof ApiError && error.status === 409) {
      // Its history moved on in a way this save can't merge into: read it
      // again, and let the editor pick up what's there now.
      bases.delete(path);
      await readNote(path).catch(() => {});
      fsChanged.emit({
        root: rootOf(vault),
        changes: [{ kind: 'Modified', path, from: null, entry: null }],
      });
    }
    throw error;
  }
}

async function writeBytes(path: string, body: BodyInit, fresh: boolean): Promise<string> {
  const { vault, rel } = await resolve(path);
  const url = vaultUrl(vault, 'files', rel) + (fresh ? '?new=1' : '');
  const { path: placed } = await apiJson<{ path: string }>(url, { method: 'PUT', body });
  await refresh();
  return `${rootOf(vault)}/${placed}`;
}

async function op(path: string, body: Record<string, unknown>): Promise<{ path?: string; id?: string }> {
  const { vault } = await resolve(path);
  const reply = await apiJson<{ path?: string; id?: string }>(vaultUrl(vault, 'ops'), {
    method: 'POST',
    json: body,
  });
  await refresh();
  return reply;
}

async function rel(path: string): Promise<string> {
  return (await resolve(path)).rel;
}

async function sameVault(a: string, b: string) {
  const [x, y] = await Promise.all([resolve(a), resolve(b)]);
  if (x.vault.id !== y.vault.id) throw new Error("Files can't move between vaults.");
  return { from: x.rel, to: y.rel };
}

// ---------------------------------------------------------------- keymap

export const keymapChanged = new Emitter<null>();
const KEYMAP = '/v1/web/settings/global.keymap';

async function overrides(): Promise<Record<string, string>> {
  const stored = await apiJson<{ overrides?: Record<string, string> }>(KEYMAP);
  return stored.overrides ?? {};
}

async function saveOverrides(next: Record<string, string>) {
  await apiJson(KEYMAP, { method: 'PUT', json: { overrides: next } });
  keymapChanged.emit(null);
}

async function resolvedCommands(): Promise<CommandMeta[]> {
  const o = await overrides();
  return (registry.commands as CommandMeta[]).map((c) =>
    o[c.id] ? { ...c, accelerator: o[c.id], is_overridden: true } : c,
  );
}

function withAccelerators(entries: ResolvedMenuEntry[], byId: Map<string, CommandMeta>): ResolvedMenuEntry[] {
  return entries.map((e) => {
    if (typeof e === 'object' && 'Command' in e && e.Command) {
      return { Command: byId.get(e.Command.id) ?? e.Command };
    }
    if (typeof e === 'object' && 'Submenu' in e && e.Submenu) {
      return { Submenu: { title: e.Submenu.title, entries: withAccelerators(e.Submenu.entries, byId) } };
    }
    return e;
  });
}

// ---------------------------------------------------------------- sync

async function reviews(): Promise<SyncReview[]> {
  const vault = currentVault();
  if (!vault) return [];
  const list = await apiJson<{ path: string; kind: string; at: number; device: string }[]>(
    vaultUrl(vault, 'reviews'),
  );
  // The web app knows notes by path, so a review's id is its path.
  return list.map((r) => ({ id: r.path, path: r.path, kind: r.kind, at: r.at, device: r.device }));
}

export const webCommands: Commands = {
  listDirectory: (path) => attempt(() => listDirectory(path)),
  readFile: (path) =>
    attempt(async () => {
      if (isNote(path)) return readNote(path);
      const { vault, rel } = await resolve(path);
      return (await api(vaultUrl(vault, 'files', rel))).text();
    }),
  writeFile: (path, contents) =>
    attempt(async () => {
      if (isNote(path)) await writeNote(path, contents);
      else await writeBytes(path, contents, false);
      return null;
    }),
  createFile: (path) =>
    attempt(async () => {
      if (await exists(path)) throw new Error(`"${path.split('/').pop()}" already exists.`);
      if (isNote(path)) await op(path, { op: 'create_note', path: await rel(path), text: '' });
      else await writeBytes(path, '', false);
      return null;
    }),
  createDirectory: (path) =>
    attempt(async () => {
      await op(path, { op: 'create_folder', path: await rel(path) });
      return null;
    }),
  renamePath: (oldPath, newPath) =>
    attempt(async () => {
      await op(oldPath, { op: 'rename', ...(await sameVault(oldPath, newPath)) });
      const base = bases.get(oldPath);
      if (base) bases.set(newPath, base);
      return null;
    }),
  deleteFile: (path) =>
    attempt(async () => {
      await op(path, { op: 'trash', path: await rel(path) });
      return null;
    }),
  deleteDirectory: (path) =>
    attempt(async () => {
      await op(path, { op: 'trash', path: await rel(path) });
      return null;
    }),
  copyPath: () => desktopOnly('Copying to a chosen place'),
  movePath: (from, to) =>
    attempt(async () => {
      await op(from, { op: 'rename', ...(await sameVault(from, to)) });
      return null;
    }),
  trashPath: (path) =>
    attempt(async () => {
      await op(path, { op: 'trash', path: await rel(path) });
      return null;
    }),
  duplicatePath: (path) =>
    attempt(async () => {
      const { vault } = await resolve(path);
      const reply = await op(path, { op: 'duplicate', path: await rel(path) });
      return `${rootOf(vault)}/${reply.path}`;
    }),
  exists: (path) => exists(path),
  saveAttachment: (dir, fileName, contents) =>
    attempt(() => writeBytes(`${dir}/${fileName}`, new Uint8Array(contents), true)),
  importAttachment: (from, intoDir) =>
    attempt(async () => {
      // `from` is what the web file picker returned: a blob URL.
      const blob = await (await fetch(from)).blob();
      return writeBytes(`${intoDir}/${attachmentName(from)}`, blob, true);
    }),
  listWorkspaceFilesRecursive: (path) => attempt(() => listRecursive(path)),
  setWorkspace: (path) =>
    attempt(async () => {
      await open(path);
      return null;
    }),
  getWorkspace: async () => {
    const vault = currentVault();
    return vault ? rootOf(vault) : null;
  },
  allowAssetPath: () => Promise.resolve({ status: 'ok', data: null }),
  // The server always says what changed; there's no watcher to turn off.
  setWatchEnabled: () => Promise.resolve({ status: 'ok', data: null }),
  getCommandRegistry: () => resolvedCommands().catch(() => registry.commands as CommandMeta[]),
  setKeybind: (commandId: CommandId, accelerator: string) =>
    attempt(async () => {
      await saveOverrides({ ...(await overrides()), [commandId]: accelerator });
      return null;
    }),
  clearKeybind: (commandId: CommandId) =>
    attempt(async () => {
      const next = await overrides();
      delete next[commandId];
      await saveOverrides(next);
      return null;
    }),
  setMenuAcceleratorsEnabled: () => Promise.resolve({ status: 'ok', data: null }),
  getMenuLayout: async () => {
    const commands = await resolvedCommands().catch(() => registry.commands as CommandMeta[]);
    const byId = new Map(commands.map((c) => [c.id, c]));
    return (registry.menus as ResolvedMenu[]).map((m) => ({
      title: m.title,
      entries: withAccelerators(m.entries, byId),
    }));
  },
  getNativeMenuCommandIds: () => Promise.resolve([]),
  listUserThemes: () => Promise.resolve({ status: 'ok', data: [] }),
  ensureThemeDir: () => desktopOnly('A themes folder'),
  listSystemFonts: () => Promise.resolve({ status: 'ok', data: [] }),
  syncAccount: () => attempt(async () => (await apiJson<{ username: string }>('/v1/me')).username),
  syncServerInfo: () => desktopOnly('Linking a folder to sync'),
  syncSignIn: () => desktopOnly('Signing in to sync'),
  syncSignOut: () => desktopOnly('Signing out of sync'),
  syncVaults: () => desktopOnly('Linking a folder to sync'),
  syncCreateVault: () => desktopOnly('Linking a folder to sync'),
  syncCreateToken: () => desktopOnly('Making a token'),
  syncLink: () => desktopOnly('Linking a folder to sync'),
  syncUnlink: () => desktopOnly('Unlinking a folder'),
  syncReconnect: () => {
    reconnect();
    return Promise.resolve({ status: 'ok', data: null });
  },
  syncStatus: () =>
    attempt(async (): Promise<SyncInfo | null> => {
      const vault = currentVault();
      if (!vault) return null;
      const state = currentSocketState();
      return {
        server: location.origin,
        vault_id: vault.id,
        vault_name: vault.name,
        device: 'web',
        state,
        message: state === 'offline' ? "Can't reach the server; changes wait until it's back." : null,
        reviews: (await reviews()).length,
      };
    }),
  syncReviews: () => attempt(reviews),
  syncReviewVersions: (id) =>
    attempt(async () => {
      const vault = currentVault();
      if (!vault) throw new Error('No vault is open.');
      return apiJson<SyncVersions>(vaultUrl(vault, 'reviews', id));
    }),
  syncResolveReview: (id, text) =>
    attempt(async () => {
      const vault = currentVault();
      if (!vault) throw new Error('No vault is open.');
      await apiJson(vaultUrl(vault, 'reviews', id), { method: 'POST', json: { text } });
      bases.delete(`${rootOf(vault)}/${id}`);
      return null;
    }),
  // Saves carry the base read with the note; nothing to record up front.
  syncEditorOpened: () => Promise.resolve(),
  // A vault's root is named after it.
  syncVaultNames: async (paths) => {
    const vault = currentVault();
    return paths.map((p) => (vault && p === rootOf(vault) ? vault.name : p.replace(/^\/+/, '').split('/')[0] || null));
  },
};
