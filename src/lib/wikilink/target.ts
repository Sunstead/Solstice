import { stripPresetExtension } from '@/lib/stores/entry-input';

const SEPARATOR = '/';

export const WIKILINK_OPEN = '[[';
export const WIKILINK_CLOSE = ']]';

/**
 * A wikilink is `[[target]]` on a single line. Brackets are disallowed inside
 * the target, so the construct can never overlap ordinary link syntax and a
 * match is always unambiguous in both directions.
 *
 * The leading `(?<!!)` is what keeps a link from being found inside an embed:
 * `![[note]]` is an embed, and without the guard the `[[note]]` within it would
 * be marked as a plain link while it is still being typed.
 */
export const WIKILINK_SOURCE = String.raw`(?<!!)\[\[([^[\]\n]+)\]\]`;

/** The embed form of the same construct, used by its input rule. */
export const EMBED_SOURCE = String.raw`!\[\[([^[\]\n]+)\]\]`;

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

export interface WikilinkParts {
  /** The file part, with no heading or suffix. May be empty for `[[#here]]`. */
  path: string;
  heading: string | null;
  /** Text after `|`: a display alias on a link, a size on an embed. */
  suffix: string | null;
}

/**
 * Splits `notes/spec#Design|400` into its parts.
 *
 * The tokenizer treats `#` and `|` as ordinary target characters, so this is
 * the one place their meaning is decided -- and the reason resolution must be
 * given `parts.path` rather than the raw target.
 */
export function parseWikilinkTarget(raw: string): WikilinkParts {
  const pipe = raw.indexOf('|');
  const head = pipe === -1 ? raw : raw.slice(0, pipe);
  const suffix = pipe === -1 ? null : raw.slice(pipe + 1);

  const hash = head.indexOf('#');

  return {
    path: (hash === -1 ? head : head.slice(0, hash)).trim(),
    heading: hash === -1 ? null : head.slice(hash + 1).trim() || null,
    suffix,
  };
}

/** Exact inverse of `parseWikilinkTarget`, for rewriting a target in place. */
export function buildWikilinkTarget(parts: WikilinkParts): string {
  const heading = parts.heading === null ? '' : `#${parts.heading}`;
  const suffix = parts.suffix === null ? '' : `|${parts.suffix}`;

  return `${parts.path}${heading}${suffix}`;
}
