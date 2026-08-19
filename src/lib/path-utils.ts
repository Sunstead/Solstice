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
