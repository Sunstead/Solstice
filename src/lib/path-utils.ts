// Windows paths use backslashes; normalize so splitting/comparison is consistent
export function normalizePath(path: string) {
  return path.replace(/\\/g, '/').replace(/\/+$/, '');
}

/**
 * Returns `filePath` relative to `workspacePath`, e.g. turns
 * `/Users/me/notes/foo/bar.md` + `/Users/me/notes` into `foo/bar.md`.
 * Falls back to the (normalized) full path if `filePath` isn't actually
 * inside `workspacePath`.
 */
export function getRelativePath(filePath: string, workspacePath: string) {
  const normalizedWorkspace = normalizePath(workspacePath);
  const normalizedFile = normalizePath(filePath);

  const relative = normalizedFile.startsWith(normalizedWorkspace)
    ? normalizedFile.slice(normalizedWorkspace.length)
    : normalizedFile;

  return relative.replace(/^\/+/, '');
}

/**
 * Splits a file path into its workspace root name and the path segments
 * relative to that root, for building breadcrumb trails. Each segment
 * carries its full absolute path so callers can navigate directly to it.
 */
export function getWorkspaceRelativeSegments(
  filePath: string,
  workspacePath: string,
) {
  const normalizedWorkspace = normalizePath(workspacePath);
  const workspaceName = normalizedWorkspace.split('/').pop() ?? 'Home';
  const relative = getRelativePath(filePath, workspacePath);

  const segments = relative.split('/').filter(Boolean);

  const crumbs = segments.map((segment, index) => ({
    label: segment,
    path: `${normalizedWorkspace}/${segments.slice(0, index + 1).join('/')}`,
    isLast: index === segments.length - 1,
  }));

  return { workspaceName, normalizedWorkspace, crumbs, relative };
}

export function getFileNameFromPath(path: string) {
  const normalized = normalizePath(path);
  return normalized.substring(normalized.lastIndexOf('/') + 1);
}

/**
 * Path comparison helpers. Store keys keep whatever separators the OS gave
 * them -- they are handed straight back to `list_directory`/`read_file` -- so
 * normalization belongs here, at the point of comparison, rather than at the
 * point of storage.
 */
export function isSamePath(a: string, b: string) {
  return normalizePath(a) === normalizePath(b);
}

/** Whether `child` is `ancestor` itself or lives somewhere beneath it. */
export function isWithin(child: string, ancestor: string) {
  const normalizedChild = normalizePath(child);
  const normalizedAncestor = normalizePath(ancestor);

  return (
    normalizedChild === normalizedAncestor ||
    normalizedChild.startsWith(`${normalizedAncestor}/`)
  );
}

/** The normalized parent directory of `path`, or `''` at the root. */
export function parentPath(path: string) {
  const normalized = normalizePath(path);
  const index = normalized.lastIndexOf('/');

  return index === -1 ? '' : normalized.substring(0, index);
}

/**
 * Separator-native counterparts to `parentPath`/`normalizePath`. Store keys
 * and Tauri command arguments keep whatever separators the OS handed us, so
 * anything that produces a path to feed *back* to the backend has to preserve
 * them rather than normalize.
 */
export function joinPath(parentPath: string, name: string): string {
  const separator = parentPath.includes('\\') ? '\\' : '/';

  return parentPath.endsWith(separator)
    ? `${parentPath}${name}`
    : `${parentPath}${separator}${name}`;
}

export function parentOf(path: string): string {
  const separator = path.includes('\\') ? '\\' : '/';
  const index = path.lastIndexOf(separator);

  return index === -1 ? '' : path.slice(0, index);
}

/**
 * Every directory between `root` and `path`, outermost first, excluding the
 * root itself and `path`. Built with `joinPath` off `root` so the results keep
 * the OS's own separators -- `useFiles.entries` is keyed by the paths the
 * backend handed back, so a chain built from normalized segments would miss
 * every lookup on Windows.
 */
export function ancestorChain(root: string, path: string): string[] {
  if (!isWithin(path, root)) return [];

  const relative = getRelativePath(path, root);
  const segments = relative.split('/').filter(Boolean);

  // The last segment is the entry itself, not one of its ancestors.
  return segments.slice(0, -1).reduce<string[]>((chain, segment) => {
    chain.push(joinPath(chain[chain.length - 1] ?? root, segment));
    return chain;
  }, []);
}

/**
 * Path of `target` as written from inside `fromDir`, e.g. `/w/notes` +
 * `/w/attachments/a.png` -> `../attachments/a.png`. Both arguments must be
 * absolute.
 *
 * Links are written note-relative because that is what `![](...)` means in
 * every other markdown tool; the resolver additionally accepts the
 * workspace-relative form that Obsidian writes.
 */
export function relativeFromDirectory(fromDir: string, target: string): string {
  const from = normalizePath(fromDir).split('/').filter(Boolean);
  const to = normalizePath(target).split('/').filter(Boolean);

  let shared = 0;
  while (shared < from.length && shared < to.length && from[shared] === to[shared]) {
    shared += 1;
  }

  const up = Array<string>(from.length - shared).fill('..');
  return [...up, ...to.slice(shared)].join('/');
}
