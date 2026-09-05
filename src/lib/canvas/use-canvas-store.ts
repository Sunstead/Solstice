import { createContext, useContext } from 'react';
import { useStore } from 'zustand';

import type { CanvasState, CanvasStore } from './store';

/**
 * The React binding for a board's store.
 *
 * A context rather than a module-level store, because the store is per tab --
 * two boards open in a split each need their own selection, viewport and undo
 * stack.
 */
const CanvasStoreContext = createContext<CanvasStore | null>(null);

export const CanvasStoreProvider = CanvasStoreContext.Provider;

/** The store handle, for imperative reads inside handlers bound once. */
export function useCanvasStoreApi(): CanvasStore {
  const store = useContext(CanvasStoreContext);
  if (!store) {
    throw new Error('useCanvasStoreApi must be used inside a canvas editor');
  }
  return store;
}

/** A reactive slice. Selectors keep a drag from re-rendering the whole board. */
export function useCanvasStore<T>(selector: (state: CanvasState) => T): T {
  return useStore(useCanvasStoreApi(), selector);
}
