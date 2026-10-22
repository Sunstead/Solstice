import { describe, expect, it, vi } from 'vitest';

import { createBoardStore, onBoardEdit } from './store';

describe('createBoardStore', () => {
  it('saves each commit, undo and redo, but not a load', () => {
    const saved = vi.fn();
    const store = createBoardStore('a');
    onBoardEdit(store, saved);
    store.getState().commit('b');
    store.getState().commit('b');
    store.getState().undo();
    store.getState().redo();
    expect(saved.mock.calls.map(([text]) => text)).toEqual(['b', 'a', 'b']);
    store.getState().load('disk');
    expect(saved).toHaveBeenCalledTimes(3);
    expect(store.getState().text).toBe('disk');
  });

  it('forgets undo on a load from disk', () => {
    const store = createBoardStore('a');
    store.getState().commit('b');
    store.getState().load('c');
    store.getState().undo();
    expect(store.getState().text).toBe('c');
  });
});
