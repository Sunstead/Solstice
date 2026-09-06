import { createStore, type StoreApi } from 'zustand/vanilla';

import {
  canRedo as historyCanRedo,
  canUndo as historyCanUndo,
  EMPTY_HISTORY,
  pushHistory,
  redoHistory,
  undoHistory,
  type History,
} from './history';
import { IDLE, type Interaction } from './interaction';
import type { CanvasDoc, Size } from './types';
import { IDENTITY_VIEWPORT, type Viewport } from './viewport';

/**
 * One board's state.
 *
 * A vanilla store behind a React context, not the global `create()` singleton
 * this codebase uses elsewhere: two canvas tabs can be open in a split and must
 * not share a selection, a viewport or an undo stack.
 *
 * Not a reducer, and not `useState`. The wheel listener, the pointer state
 * machine and the scoped command handlers are all closures created once, and
 * every one of them needs to read *current* state. That is exactly the
 * staleness `image-viewer.tsx` works around with `scaleRef`/`offsetRef`;
 * `getState()` removes the problem structurally rather than mirroring around
 * it. Per-slice subscription is the other half: dragging one node must not
 * re-render two hundred others.
 */

export type SelectionMode = 'replace' | 'toggle' | 'add';

export interface CanvasState {
  doc: CanvasDoc;

  /** Node *and* edge ids in one set: Delete and colour both act on either. */
  selection: ReadonlySet<string>;
  editingNodeId: string | null;

  /**
   * Deliberately outside the history and outside the autosaver. JSON Canvas
   * stores no viewport, and where someone was looking is not an edit to undo.
   */
  view: Viewport;
  /** The surface's measured size, for fit and for culling. */
  pane: Size;

  interaction: Interaction;
  history: History;

  /** Replaces the document, records history, and schedules a write. */
  commit(next: CanvasDoc, options?: { coalesceKey?: string }): void;
  /**
   * Replaces the document for rendering only.
   *
   * What keeps a drag from writing the file once per frame in `editor.autosave
   * = 'change'` mode -- and, because only pointerup commits, what makes each
   * gesture exactly one history entry with no coalescing logic anywhere.
   */
  preview(next: CanvasDoc): void;

  /**
   * Ends a gesture that had been previewing.
   *
   * `before` is the document as it stood when the gesture started, and is what
   * lands in the undo stack. `commit` alone would record the *last previewed
   * frame* instead, so undoing a drag would step back one animation frame
   * rather than to where the node came from.
   */
  commitGesture(before: CanvasDoc, next: CanvasDoc): void;

  undo(): void;
  redo(): void;
  canUndo(): boolean;
  canRedo(): boolean;

  setView(view: Viewport): void;
  setPane(pane: Size): void;
  setInteraction(interaction: Interaction): void;
  setEditing(id: string | null): void;

  /**
   * Registers the currently-mounted card editor's "commit whatever you have,
   * right now" callback. `setEditing` calls whatever is registered for the
   * node it is leaving *before* changing `editingNodeId` -- which is what
   * unmounts that editor -- because Milkdown's `markdownUpdated` listener is
   * debounced by ~200ms, and a card left within that window would otherwise
   * unmount before the debounce ever fires, silently dropping the keystrokes
   * it was about to report. Returns an unregister function.
   */
  registerCardFlush(id: string, flush: () => void): () => void;

  select(ids: Iterable<string>, mode?: SelectionMode): void;
  clearSelection(): void;
}

export type CanvasStore = StoreApi<CanvasState>;

const EMPTY_SELECTION: ReadonlySet<string> = new Set();

export function createCanvasStore(
  initial: CanvasDoc,
  /** Called for every committed change; the tab turns it into a write. */
  onDocChanged: (doc: CanvasDoc) => void,
): CanvasStore {
  // Not store state: nothing should re-render off who currently holds a flush
  // callback, and the callback itself closes over a live Milkdown instance
  // that has no business being kept in a serializable snapshot.
  const cardFlush = new Map<string, () => void>();

  return createStore<CanvasState>((set, get) => ({
    doc: initial,
    selection: EMPTY_SELECTION,
    editingNodeId: null,
    view: IDENTITY_VIEWPORT,
    pane: { width: 0, height: 0 },
    interaction: IDLE,
    history: EMPTY_HISTORY,

    commit(next, options) {
      const { doc, history } = get();
      // Operations in `doc.ts` return the same object when they changed
      // nothing, so a no-op never reaches the undo stack or the disk.
      if (next === doc) return;

      set({
        doc: next,
        history: pushHistory(history, doc, options?.coalesceKey),
      });
      onDocChanged(next);
    },

    preview(next) {
      if (next === get().doc) return;
      set({ doc: next });
    },

    commitGesture(before, next) {
      const { history } = get();
      // Compared against `before`, not against the previewed document: a drag
      // that ends exactly where it started has changed nothing, however many
      // frames it rendered on the way.
      if (next === before) {
        set({ doc: before });
        return;
      }

      set({ doc: next, history: pushHistory(history, before) });
      onDocChanged(next);
    },

    undo() {
      const { history, doc } = get();
      const result = undoHistory(history, doc);
      if (!result) return;

      set({ doc: result.doc, history: result.history });
      onDocChanged(result.doc);
    },

    redo() {
      const { history, doc } = get();
      const result = redoHistory(history, doc);
      if (!result) return;

      set({ doc: result.doc, history: result.history });
      onDocChanged(result.doc);
    },

    canUndo: () => historyCanUndo(get().history),
    canRedo: () => historyCanRedo(get().history),

    setView: (view) => set({ view }),

    setPane(pane) {
      const current = get().pane;
      if (current.width === pane.width && current.height === pane.height) return;
      set({ pane });
    },

    setInteraction: (interaction) => set({ interaction }),

    setEditing(id) {
      const current = get().editingNodeId;
      if (current === id) return;
      // Give the card being left one last chance to land its freshest text --
      // see `registerCardFlush`. Runs first: the card is still mounted at this
      // point, and only the `set` below triggers the re-render that tears it
      // down.
      if (current !== null) cardFlush.get(current)?.();
      set({ editingNodeId: id });
    },

    registerCardFlush(id, flush) {
      cardFlush.set(id, flush);
      return () => {
        if (cardFlush.get(id) === flush) cardFlush.delete(id);
      };
    },

    select(ids, mode = 'replace') {
      const current = get().selection;

      if (mode === 'replace') {
        const next = new Set(ids);
        // A new Set every time would re-render every card on every click, so
        // an unchanged selection returns the object already in the store.
        if (next.size === current.size && [...next].every((id) => current.has(id))) {
          return;
        }
        set({ selection: next });
        return;
      }

      const next = new Set(current);
      for (const id of ids) {
        if (mode === 'toggle' && next.has(id)) next.delete(id);
        else next.add(id);
      }

      set({ selection: next });
    },

    clearSelection() {
      if (get().selection.size === 0) return;
      set({ selection: EMPTY_SELECTION });
    },
  }));
}
