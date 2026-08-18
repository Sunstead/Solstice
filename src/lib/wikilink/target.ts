import { stripPresetExtension } from '@/lib/stores/entry-input';

const SEPARATOR = '/';

export const WIKILINK_OPEN = '[[';
export const WIKILINK_CLOSE = ']]';

/**
 * A wikilink is `[[target]]` on a single line. Brackets are disallowed inside
 * the target, so the construct can never overlap ordinary link syntax and a
 * match is always unambiguous in both directions.
 */
export const WIKILINK_SOURCE = String.raw`\[\[([^[\]\n]+)\]\]`;

/**
 * Canonical form of a target: forward slashes, no leading `./` or `/`, no
 * trailing slash. Targets are hand-written, so anything that compares or
 * stores one normalizes first. Decorations work from the raw text instead,
 * because they are positioned against it.
 */
export function normalizeTarget(raw: string): string {
  return raw
    .trim()
    .replace(/\\/g, SEPARATOR)
    .replace(/\/{2,}/g, SEPARATOR)
    .replace(/^\.?\//, '')
    .replace(/\/+$/, '');
}

export function basename(path: string): string {
  const index = path.lastIndexOf(SEPARATOR);
  return index === -1 ? path : path.slice(index + 1);
}

/** Offset of the file name within a path, i.e. the length of its directories. */
export function basenameOffset(path: string): number {
  return path.lastIndexOf(SEPARATOR) + 1;
}

/** Drops the extension the workspace treats as implicit, keeping directories. */
export function stripExtension(path: string): string {
  const offset = basenameOffset(path);
  return path.slice(0, offset) + stripPresetExtension(path.slice(offset)).name;
}

/**
 * Lookup key for the index. Matching is case-insensitive because a workspace
 * is routinely edited from both case-sensitive and case-insensitive file
 * systems, and a link that resolves on one must resolve on the other.
 */
export function indexKey(value: string): string {
  return normalizeTarget(value).toLowerCase();
}

/** How a file is named throughout the UI: no directories, no extension. */
export function wikilinkLabel(target: string): string {
  return stripExtension(basename(normalizeTarget(target)));
}

export function joinWorkspacePath(root: string, relativePath: string): string {
  return `${root.replace(/[\\/]+$/, '')}${SEPARATOR}${relativePath}`;
}