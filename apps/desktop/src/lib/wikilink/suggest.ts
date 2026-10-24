import { shortestWikilinkTarget, type WikilinkIndexSnapshot } from '@/lib/stores/wikilink-index';
import { basename, stripExtension, WIKILINK_CLOSE, WIKILINK_OPEN } from './target';

/**
 * The rules of the `[[` suggestions, shared by the rich editor and source
 * mode (`suggest-menu.ts` wires them into each).
 */

/** An unclosed `[[` in `before` (a line up to the caret): where, and what follows it. */
export function wikilinkQuery(before: string): { offset: number; query: string } | null {
  // A `#heading` or `|alias` is past the file: nothing to suggest there.
  // U+FFFC is an inline node (an image) in the rich editor's text.
  const match = /\[\[([^[\]|#\n\uFFFC]{0,100})$/.exec(before);
  return match ? { offset: match.index, query: match[1] } : null;
}

/**
 * Where a chosen suggestion's text ends: the caret, or past the `]]` right
 * after it (the rich editor pairs brackets, so `[[` arrives as `[[]]`).
 */
export function suggestEnd(head: number, after: string): number {
  return after.startsWith(WIKILINK_CLOSE) ? head + WIKILINK_CLOSE.length : head;
}

/** The link a suggestion writes: the shortest target that finds only it. */
export function suggestedLink(path: string, index: WikilinkIndexSnapshot): string {
  return `${WIKILINK_OPEN}${shortestWikilinkTarget(path, index)}${WIKILINK_CLOSE}`;
}

const isNote = (path: string) => path.toLowerCase().endsWith('.md');

/** A file's name as matched: no folders, no extension. */
function nameOf(path: string): string {
  const base = basename(path);
  const stem = stripExtension(base);
  if (stem !== base) return stem;
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(0, dot) : base;
}

function inOrder(query: string, text: string): boolean {
  let i = 0;
  for (const ch of text) if (ch === query[i] && ++i === query.length) return true;
  return query.length === 0;
}

/** How well `path` answers `query` (lowercased): lower is better, null is not at all. */
function tier(path: string, query: string): number | null {
  if (!query) return 0;
  const name = nameOf(path).toLowerCase();
  const full = path.toLowerCase();
  if (name === query) return 0;
  if (name.startsWith(query)) return 1;
  if (name.split(/[^\p{L}\p{N}]+/u).some((word) => word.startsWith(query))) return 2;
  if (name.includes(query)) return 3;
  if (full.includes(query)) return 4;
  if (inOrder(query, full)) return 5;
  return null;
}

/**
 * Workspace-relative `paths` that answer `query`, best first: by how the
 * name matches (itself, its start, a word's start, anywhere, then the path,
 * then its letters in order), notes before other files within each, then by
 * name.
 */
export function rankWikilinkTargets(paths: Iterable<string>, query: string, limit = 50): string[] {
  const q = query.trim().toLowerCase();
  const ranked: { path: string; tier: number; note: number; name: string }[] = [];
  for (const path of paths) {
    const t = tier(path, q);
    if (t !== null) ranked.push({ path, tier: t, note: isNote(path) ? 0 : 1, name: nameOf(path).toLowerCase() });
  }
  ranked.sort(
    (a, b) =>
      a.tier - b.tier || a.note - b.note || a.name.localeCompare(b.name) || a.path.localeCompare(b.path),
  );
  return ranked.slice(0, limit).map((r) => r.path);
}

/** Where the open `[[` is (a document position) and what's typed after it. */
export interface SuggestAt {
  from: number;
  query: string;
}

export interface SuggestState {
  open: SuggestAt | null;
  /** The `[[` whose suggestions Escape closed, until the caret leaves it. */
  dismissed: number | null;
}

export const SUGGEST_CLOSED: SuggestState = { open: null, dismissed: null };

/**
 * The next state after an update. `at` is the caret's `[[` now, if any. The
 * menu opens only on an edit (typing `[[`, not clicking into a link) and
 * follows the caret while it stays in the link.
 */
export function stepSuggest(
  prev: SuggestState,
  update: { at: SuggestAt | null; docChanged: boolean; close?: boolean; map: (pos: number) => number },
): SuggestState {
  const { at, docChanged, close, map } = update;
  if (!at) return SUGGEST_CLOSED;
  if (close) return { open: null, dismissed: at.from };
  const dismissed = prev.dismissed === null ? null : map(prev.dismissed);
  if (dismissed === at.from) return { open: null, dismissed };
  return { open: prev.open || docChanged ? at : null, dismissed: null };
}
