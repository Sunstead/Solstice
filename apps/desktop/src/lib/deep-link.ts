import type { KnownWorkspace } from '@/lib/stores/known-workspaces';
import { normalizeTarget } from '@/lib/wikilink/target';

/**
 * `solstice://open?vault=<name>&path=<relative path>` opens a note. Atlas
 * builds these from the notes it indexes under `data/notes/<user>/<vault>/`.
 *
 * A vault is matched to a workspace this machine has opened before: first
 * one linked to a Solstice Sync vault of that name (Atlas names vaults by
 * their folder on the server, which is the vault's name), then one whose
 * own folder has that name.
 */
export interface DeepLink {
  vault: string;
  /** Workspace-relative, forward slashes. */
  path: string;
}

export function parseDeepLink(raw: string): DeepLink | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'solstice:') return null;

  // `solstice://open?...` puts `open` in the host; `solstice:open?...` in the path.
  const action = (url.host || url.pathname).replace(/^\/+|\/+$/g, '');
  if (action !== 'open') return null;

  const vault = url.searchParams.get('vault')?.trim();
  const path = normalizeTarget(url.searchParams.get('path') ?? '');
  if (!vault || !path) return null;

  // Relative to the vault and inside it: no drive letters, no climbing out.
  const segments = path.split('/');
  if (/^[a-z]:/i.test(path) || segments.some((s) => s === '..' || s === '.')) return null;

  return { vault, path };
}

export function folderName(path: string): string {
  return path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? path;
}

/**
 * Known workspaces for `vault`, best first: those linked to a sync vault of
 * that name (`linked` maps a workspace path to its vault's name), then
 * those whose folder has the name; most recently opened first within each.
 */
export function workspacesForVault(
  vault: string,
  known: readonly KnownWorkspace[],
  linked: ReadonlyMap<string, string> = new Map(),
): KnownWorkspace[] {
  const wanted = vault.toLowerCase();
  const rank = (w: KnownWorkspace) =>
    linked.get(w.path)?.toLowerCase() === wanted ? 0 : folderName(w.path).toLowerCase() === wanted ? 1 : 2;
  return known
    .filter((w) => rank(w) < 2)
    .sort((a, b) => rank(a) - rank(b) || b.lastOpenedAt - a.lastOpenedAt);
}
