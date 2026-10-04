import { assetUrl } from '@/lib/backend/shell';

import {
  useWikilinkIndex,
  type WikilinkIndexSnapshot,
} from '@/lib/stores/wikilink-index';
import { basename, indexKey, joinWorkspacePath } from '@/lib/wikilink/target';
import { getRelativePath, normalizePath, parentPath } from '@/lib/path-utils';

export type ResolvedAsset =
  /** A remote or already-absolute URL; handed to the browser untouched. */
  | { status: 'external'; url: string }
  | { status: 'resolved'; absolutePath: string; url: string }
  | { status: 'unresolved' };

/** Anything of the form `scheme:` is the browser's problem, not ours. */
const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/**
 * Percent-encoding is how a serializer writes a path containing spaces, so a
 * link this app wrote itself can come back as `my%20image.png`. A malformed
 * escape is not worth failing over -- fall back to the raw text.
 */
function decodePath(src: string): string {
  try {
    return decodeURI(src);
  } catch {
    return src;
  }
}

/** Applies `.` and `..` segments of `relative` against `base`. */
function resolveSegments(base: string, relative: string): string {
  const segments = base ? base.split('/') : [];

  for (const part of relative.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') segments.pop();
    else segments.push(part);
  }

  return segments.join('/');
}

/**
 * Turns an image or embed `src` into something the webview can load.
 *
 * Candidates are tried in Obsidian's order: relative to the note (which is
 * what CommonMark actually means, and what this app writes), then relative to
 * the workspace root, then as a bare file name. Supporting all three is what
 * lets a vault written elsewhere open here without rewriting its links.
 *
 * Resolution runs against the wikilink index rather than hitting the disk, so
 * it is synchronous and costs nothing to call from a render.
 */
export function resolveAsset(
  src: string,
  options: { notePath: string; workspaceRoot: string | null },
  index: WikilinkIndexSnapshot = useWikilinkIndex.getState(),
): ResolvedAsset {
  const raw = src.trim();
  if (!raw) return { status: 'unresolved' };

  if (HAS_SCHEME.test(raw)) return { status: 'external', url: raw };

  const decoded = decodePath(raw);
  const { workspaceRoot, notePath } = options;

  // An absolute path is already the answer; it just needs an asset URL. This
  // also covers the Windows `C:\...` form, which `HAS_SCHEME` deliberately
  // does not match (a drive letter is one character, a scheme is two or more).
  if (decoded.startsWith('/') || /^[a-z]:[\\/]/i.test(decoded)) {
    return { status: 'resolved', absolutePath: decoded, url: assetUrl(decoded) };
  }

  if (!workspaceRoot) return { status: 'unresolved' };

  const noteDir = parentPath(getRelativePath(notePath, workspaceRoot));
  const candidates = [
    resolveSegments(noteDir, decoded),
    normalizePath(decoded),
  ];

  for (const candidate of candidates) {
    const hit = index.byPath.get(indexKey(candidate));
    if (hit) return resolvedAt(workspaceRoot, hit);
  }

  // Bare file name, e.g. `![[diagram.png]]` written from anywhere in the
  // vault. `byName` only drops the extension the workspace treats as implicit
  // (`.md`), so an image indexes under its full file name. Accepted only when
  // it names exactly one file -- guessing between two would silently show the
  // wrong image.
  const named = index.byName.get(indexKey(basename(normalizePath(decoded))));
  if (named?.length === 1) return resolvedAt(workspaceRoot, named[0]);

  return { status: 'unresolved' };
}

function resolvedAt(workspaceRoot: string, relativePath: string): ResolvedAsset {
  const absolutePath = joinWorkspacePath(workspaceRoot, relativePath);
  return { status: 'resolved', absolutePath, url: assetUrl(absolutePath) };
}
