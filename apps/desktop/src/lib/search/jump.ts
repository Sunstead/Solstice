import type { Jump, Query } from '@/bindings';
import { useFindStore } from '@/lib/stores/find';

/**
 * Opens a search hit: the find bar takes the search's query and options, and
 * the file's editor is left `jump` to take once it has loaded (each editor
 * goes there its own way: a match, a line, a page, a card).
 */
export function openSearchHit(path: string, jump: Jump, length: number, query: Query, open: (path: string) => void) {
  const find = useFindStore.getState();
  find.setQuery(query.text);
  find.setOptions(query.case_sensitive, query.whole_word);
  find.requestJump(path, jump, length);
  open(path);
}

/**
 * Which of the rich editor's `count` find matches a jump means: its ordinal,
 * or the first where the editor has no text for the hit; -1 for none.
 */
export function matchIndex(jump: Jump, count: number): number {
  if (count === 0) return -1;
  const ordinal = jump.type === 'line' ? (jump.ordinal ?? 0) : 0;
  return Math.min(ordinal, count - 1);
}
