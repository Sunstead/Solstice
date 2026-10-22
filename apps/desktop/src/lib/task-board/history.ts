/**
 * Undo for a board: whole texts, which are small, rather than patches. A
 * reload from disk starts afresh (`EMPTY_HISTORY`), so undo never brings back
 * what another device or app replaced.
 */

/** Deep enough for a working session, shallow enough to stay bounded. */
const LIMIT = 100;

export interface History {
  past: string[];
  future: string[];
}

export const EMPTY_HISTORY: History = { past: [], future: [] };

/** Records the text an edit replaced. */
export function pushHistory(history: History, previous: string): History {
  return { past: [...history.past, previous].slice(-LIMIT), future: [] };
}

/** The text before `current`, or null with nothing to undo. */
export function undo(history: History, current: string): { history: History; text: string } | null {
  const text = history.past[history.past.length - 1];
  if (text === undefined) return null;
  return { history: { past: history.past.slice(0, -1), future: [current, ...history.future] }, text };
}

export function redo(history: History, current: string): { history: History; text: string } | null {
  const [text, ...future] = history.future;
  if (text === undefined) return null;
  return { history: { past: [...history.past, current].slice(-LIMIT), future }, text };
}
