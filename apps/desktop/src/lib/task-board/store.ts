import { createStore, type StoreApi } from 'zustand/vanilla';

import { EMPTY_HISTORY, pushHistory, redo, undo, type History } from './history';

/**
 * One open board: its note's text and undo. Every action is `commit(edit(text))`;
 * the board is parsed from the text on render, so there is one source of truth.
 * Whoever saves subscribes and writes each change whose `origin` is `edit`.
 */
export interface BoardState {
  text: string;
  history: History;
  /** What made the text what it is: a board action (to save) or the disk. */
  origin: 'edit' | 'disk';
  /** Takes an edit's result as one undo step. */
  commit: (next: string) => void;
  undo: () => void;
  redo: () => void;
  /** Text from disk: no undo step, and the old steps are gone. */
  load: (text: string) => void;
}

export type BoardStore = StoreApi<BoardState>;

export function createBoardStore(text: string): BoardStore {
  return createStore<BoardState>((set, get) => ({
    text,
    history: EMPTY_HISTORY,
    origin: 'disk',
    commit: (next) => {
      const { text: current, history } = get();
      if (next === current) return;
      set({ text: next, history: pushHistory(history, current), origin: 'edit' });
    },
    undo: () => {
      const step = undo(get().history, get().text);
      if (step) set({ ...step, origin: 'edit' });
    },
    redo: () => {
      const step = redo(get().history, get().text);
      if (step) set({ ...step, origin: 'edit' });
    },
    load: (next) => set({ text: next, history: EMPTY_HISTORY, origin: 'disk' }),
  }));
}

/** Calls `save` with each edit's text, not the disk's. Returns the unsubscribe. */
export function onBoardEdit(store: BoardStore, save: (text: string) => void): () => void {
  return store.subscribe((state, previous) => {
    if (state.text !== previous.text && state.origin === 'edit') save(state.text);
  });
}
