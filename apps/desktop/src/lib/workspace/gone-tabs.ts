import { isSamePath, isWithin } from '@/lib/path-utils';

/**
 * Which open tabs' files are gone: the workspace's by its index, and a file
 * opened from outside it (Finder, a drop), which no index has, by asking
 * the disk.
 */
export async function goneTabs(
  tabPaths: string[],
  known: { path: string }[],
  root: string,
  exists: (path: string) => Promise<boolean>,
): Promise<string[]> {
  const checks = tabPaths.map(async (path) => {
    if (isWithin(path, root)) return known.some((file) => isSamePath(file.path, path)) ? null : path;
    return (await exists(path).catch(() => true)) ? null : path;
  });
  return (await Promise.all(checks)).filter((path): path is string => path !== null);
}
