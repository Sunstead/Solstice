import type { FileEntry } from '@/bindings';
import { searchFlat, type FindOptions } from '@/lib/find/matches';

export type NameMatch = {
  entry: FileEntry;
  /** Where the name matches, `[start, end)`. */
  range: [number, number];
};

/**
 * Files whose names contain `query`, by the find bar's rules: names that
 * start with it first, then shorter names, then by path. At most `limit`,
 * with how many there are in all.
 */
export function matchNames(
  files: FileEntry[],
  query: string,
  options: FindOptions,
  limit: number,
): { matches: NameMatch[]; total: number } {
  if (!query) return { matches: [], total: 0 };
  const matches: NameMatch[] = [];
  for (const entry of files) {
    if (entry.is_dir) continue;
    const [first] = searchFlat({ text: entry.name, positions: [...entry.name] }, query, options);
    if (first) matches.push({ entry, range: [first.start, first.end] });
  }
  matches.sort(
    (a, b) =>
      Number(b.range[0] === 0) - Number(a.range[0] === 0) ||
      a.entry.name.length - b.entry.name.length ||
      a.entry.path.localeCompare(b.entry.path),
  );
  return { matches: matches.slice(0, limit), total: matches.length };
}
