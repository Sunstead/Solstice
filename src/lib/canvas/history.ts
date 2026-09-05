import type { CanvasDoc } from './types';

/**
 * Undo for a board.
 *
 * An entry is a whole document snapshot, not a patch. Because every operation
 * in `doc.ts` returns a new object sharing what it did not change, a snapshot
 * is a shallow array copy plus the handful of nodes that actually moved --
 * cheap enough that patches would buy memory nobody needs while introducing
 * inverse-patch bugs on exactly the operations that matter most (deleting
 * thirty nodes and every edge that touched them).
 */

/** Deep enough to cover a working session, shallow enough to stay bounded. */
const LIMIT = 100;

export interface History {
  past: CanvasDoc[];
  future: CanvasDoc[];
  /**
   * Set while consecutive edits of one kind should replace the top entry
   * rather than stack on it.
   *
   * Only typing uses this. A drag needs no coalescing at all, because the
   * document is only committed on pointerup -- every frame in between is a
   * preview the history never sees.
   */
  coalesceKey: string | null;
}

export const EMPTY_HISTORY: History = {
  past: [],
  future: [],
  coalesceKey: null,
};

export function pushHistory(
  history: History,
  previous: CanvasDoc,
  coalesceKey?: string,
): History {
  // A run of keystrokes in one card replaces its own top entry, so undo steps
  // back over the whole run rather than one character at a time.
  const coalescing =
    coalesceKey !== undefined &&
    coalesceKey === history.coalesceKey &&
    history.past.length > 0;

  const past = coalescing
    ? history.past
    : [...history.past, previous].slice(-LIMIT);

  return {
    past,
    // Any new edit abandons the redo branch, as everywhere else.
    future: [],
    coalesceKey: coalesceKey ?? null,
  };
}

export function canUndo(history: History): boolean {
  return history.past.length > 0;
}

export function canRedo(history: History): boolean {
  return history.future.length > 0;
}

/** @param present The document as it stands, which becomes the redo entry. */
export function undoHistory(
  history: History,
  present: CanvasDoc,
): { history: History; doc: CanvasDoc } | null {
  const doc = history.past[history.past.length - 1];
  if (doc === undefined) return null;

  return {
    doc,
    history: {
      past: history.past.slice(0, -1),
      future: [...history.future, present],
      // Undoing closes any open typing run: the next keystroke has to start a
      // new entry, or it would silently rewrite the one just restored.
      coalesceKey: null,
    },
  };
}

export function redoHistory(
  history: History,
  present: CanvasDoc,
): { history: History; doc: CanvasDoc } | null {
  const doc = history.future[history.future.length - 1];
  if (doc === undefined) return null;

  return {
    doc,
    history: {
      past: [...history.past, present],
      future: history.future.slice(0, -1),
      coalesceKey: null,
    },
  };
}
