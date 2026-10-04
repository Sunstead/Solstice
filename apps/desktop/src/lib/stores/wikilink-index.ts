import { create } from 'zustand';

import { commands } from '@/lib/backend';
import { type FileEntry } from '@/bindings';
import {
  basename,
  indexKey,
  normalizeTarget,
  stripExtension,
} from '@/lib/wikilink/target';

/**
 * Three lookup tables, queried in order of specificity:
 *
 * - `byPath`  exact relative path, extension included ("notes/todo.md")
 * - `byStem`  relative path with the implicit extension dropped ("notes/todo")
 * - `byName`  bare file name with the implicit extension dropped ("todo")
 *
 * A bare name is the shortest form a link can take; it only resolves while
 * exactly one file in the workspace answers to it, which is what forces a
 * folder path once a second file with the same name appears.
 */
export type WikilinkIndexSnapshot = {
  byPath: ReadonlyMap<string, string>;
  byStem: ReadonlyMap<string, readonly string[]>;
  byName: ReadonlyMap<string, readonly string[]>;
};

export type WikilinkResolution =
  | { status: 'resolved'; path: string }
  | { status: 'ambiguous'; candidates: readonly string[] }
  | { status: 'unresolved' };

export type WikilinkStatus = WikilinkResolution['status'];

type WikilinkIndexState = WikilinkIndexSnapshot & {
  /** Workspace root the index describes, or is currently being built for. */
  root: string | null;
  building: boolean;
  /**
   * Builds the index for `root` unless it is already current. Concurrent
   * callers share one walk, and a different root implicitly replaces the
   * previous index, so workspace switches need no explicit reset.
   */
  ensureBuilt: (root: string) => Promise<void>;
  /**
   * Forces a re-walk of `root`, keeping the current snapshot live while it
   * runs. This is the hook for file creates/renames/deletes -- in-app and
   * external alike. `invalidate` is deliberately not that hook: dropping the
   * snapshot flashes every link through "unresolved" for the length of a walk.
   */
  rebuild: (root: string) => Promise<void>;
  invalidate: () => void;
};

function emptySnapshot(): WikilinkIndexSnapshot {
  return { byPath: new Map(), byStem: new Map(), byName: new Map() };
}

function append(map: Map<string, string[]>, key: string, path: string) {
  const bucket = map.get(key);
  if (bucket) bucket.push(path);
  else map.set(key, [path]);
}

export function buildSnapshot(paths: string[]): WikilinkIndexSnapshot {
  const byPath = new Map<string, string>();
  const byStem = new Map<string, string[]>();
  const byName = new Map<string, string[]>();

  // Sorted so ambiguous candidates are reported in a stable order.
  for (const path of [...paths].sort()) {
    byPath.set(indexKey(path), path);
    append(byStem, indexKey(stripExtension(path)), path);
    append(byName, indexKey(stripExtension(basename(path))), path);
  }

  return { byPath, byStem, byName };
}

export function resolveWikilink(
  target: string,
  index: WikilinkIndexSnapshot,
): WikilinkResolution {
  const normalized = normalizeTarget(target);
  if (!normalized) return { status: 'unresolved' };

  const exact = index.byPath.get(indexKey(normalized));
  if (exact) return { status: 'resolved', path: exact };

  const table = normalized.includes('/') ? index.byStem : index.byName;
  const candidates = table.get(indexKey(normalized)) ?? [];

  if (candidates.length === 1)
    return { status: 'resolved', path: candidates[0] };
  if (candidates.length > 1) return { status: 'ambiguous', candidates };
  return { status: 'unresolved' };
}

/**
 * Shortest target that unambiguously refers to `relativePath`: the bare file
 * name where it is unique, the workspace-relative path otherwise. This is the
 * form links should be written in, so autocomplete inserts it verbatim.
 */
export function shortestWikilinkTarget(
  relativePath: string,
  index: WikilinkIndexSnapshot,
): string {
  const stem = stripExtension(normalizeTarget(relativePath));
  const name = basename(stem);
  const sameName = index.byName.get(indexKey(name)) ?? [];
  return sameName.length > 1 ? stem : name;
}

function relativeTo(root: string, fullPath: string): string {
  const normalizedRoot = normalizeTarget(root);
  const normalizedPath = normalizeTarget(fullPath);
  return normalizedPath.startsWith(`${normalizedRoot}/`)
    ? normalizedPath.slice(normalizedRoot.length + 1)
    : normalizedPath;
}

async function walk(root: string, directory: string, into: string[]) {
  let entries: FileEntry[];
  try {
    const result = await commands.listDirectory(directory);
    if (result.status === 'error') throw new Error('List directory failed');
    entries = result.data;
  } catch (error) {
    // One unreadable directory (permissions, or a delete racing the walk)
    // must not fail the whole index.
    console.error(`Wikilink index: skipped ${directory}`, error);
    return;
  }

  await Promise.all(
    entries.map(async (entry) => {
      const relativePath = relativeTo(root, entry.path);
      // Dot-directories hold tooling state (.git, .obsidian) that is never
      // link-worthy and can be very large.
      if (!relativePath || basename(relativePath).startsWith('.')) return;
      if (entry.is_dir) await walk(root, entry.path, into);
      else into.push(relativePath);
    }),
  );
}

// Held outside the store so concurrent ensureBuilt() calls (one per mounted
// editor) await the same walk instead of each starting their own.
let inFlight: { root: string; promise: Promise<void> } | null = null;

// `rebuild` drops the in-flight handle to force a fresh walk, which means two
// walks of the same root can overlap. Only the newest may publish its result,
// or a slow earlier walk could land last and reinstate a stale snapshot.
let walkSeq = 0;

export const useWikilinkIndex = create<WikilinkIndexState>((set, get) => ({
  ...emptySnapshot(),
  root: null,
  building: false,

  ensureBuilt: (root) => {
    if (inFlight?.root === root) return inFlight.promise;
    if (get().root === root && !get().building) return Promise.resolve();

    const isRebuild = get().root === root;
    const seq = ++walkSeq;
    const promise = (async () => {
      // A rebuild of the same workspace keeps serving the previous snapshot
      // so links don't flicker through "unresolved" while the walk runs.
      set({ root, building: true, ...(isRebuild ? {} : emptySnapshot()) });

      const paths: string[] = [];
      await walk(root, root, paths);

      // Discard the result if the workspace changed, or a newer walk started,
      // mid-walk.
      if (get().root !== root || seq !== walkSeq) return;
      set({ ...buildSnapshot(paths), building: false });
    })();

    inFlight = { root, promise };
    void promise.finally(() => {
      if (inFlight?.promise === promise) inFlight = null;
    });

    return promise;
  },

  rebuild: (root) => {
    // Dropping the in-flight handle forces a fresh walk, and `building: true`
    // clears ensureBuilt's "already current" guard while steering it down its
    // rebuild branch -- so the existing snapshot keeps serving throughout.
    inFlight = null;
    set({ building: true });
    return get().ensureBuilt(root);
  },

  invalidate: () => {
    inFlight = null;
    set({ ...emptySnapshot(), root: null, building: false });
  },
}));
