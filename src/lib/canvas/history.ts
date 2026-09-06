import type { CanvasDoc } from './types';

/**
 * Undo for a board. An entry is a whole document snapshot rather than a patch:
 * `doc.ts` operations share everything they did not change, so a snapshot is a
 * shallow array copy plus the nodes that actually moved.
 */

/** Deep enough to cover a working session, shallow enough to stay bounded. */
const LIMIT = 100;

export interface History {
  past: CanvasDoc[];
  future: CanvasDoc[];
  /**
   * Set while consecutive edits of one kind should replace the top entry
   * rather than stack on it. Only typing uses it -- a drag commits once, on
   * pointerup, so every frame in between is a preview history never sees.
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
  // over the run rather than one character at a time.
  const coalescing =
    coalesceKey !== undefined &&
    coalesceKey === history.coalesceKey &&
    history.past.length > 0;

  const past = coalescing
    ? history.past
    : [...history.past, previous].slice(-LIMIT);

  return {
    past,
    // Any new edit abandons the redo branch.
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
      // Undoing closes any open typing run, or the next keystroke would
      // rewrite the entry just restored.
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
