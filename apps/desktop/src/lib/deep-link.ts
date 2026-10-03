import type { KnownWorkspace } from '@/lib/stores/known-workspaces';
import { normalizeTarget } from '@/lib/wikilink/target';

/**
 * `solstice://open?vault=<name>&path=<relative path>` opens a note. Atlas
 * builds these from the notes it indexes under `data/notes/<user>/<vault>/`.
 *
 * Until Solstice Sync gives vaults ids, a vault is matched by the folder name
 * of a workspace this machine has opened before.
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

/** Known workspaces whose folder is named `vault`, most recently opened first. */
export function workspacesForVault(vault: string, known: readonly KnownWorkspace[]): KnownWorkspace[] {
  const wanted = vault.toLowerCase();
  return known
    .filter((w) => folderName(w.path).toLowerCase() === wanted)
    .sort((a, b) => b.lastOpenedAt - a.lastOpenedAt);
}
