import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Jump } from '@/bindings';
import { useFindStore } from '@/lib/stores/find';
import { matchIndex, openSearchHit } from './jump';

describe('openSearchHit', () => {
  beforeEach(() => {
    useFindStore.setState({ query: '', caseSensitive: false, wholeWord: false, jump: null });
  });

  it('carries the search into the find bar and leaves a jump for the file', () => {
    const open = vi.fn();
    const jump: Jump = { type: 'line', line: 3, column: 4, ordinal: 2 };
    openSearchHit('/ws/a.md', jump, 4, { text: 'cell', case_sensitive: true, whole_word: true }, open);

    expect(open).toHaveBeenCalledWith('/ws/a.md');
    const find = useFindStore.getState();
    expect(find.query).toBe('cell');
    expect(find.caseSensitive).toBe(true);
    expect(find.wholeWord).toBe(true);
    expect(find.jump).toMatchObject({ path: '/ws/a.md', jump, length: 4 });
  });

  it('leaves the jump before opening, for an editor that mounts at once', () => {
    let seen: unknown = null;
    openSearchHit('/ws/a.md', { type: 'handwriting' }, 4, { text: 'x', case_sensitive: false, whole_word: false }, () => {
      seen = useFindStore.getState().jump;
    });
    expect(seen).not.toBeNull();
  });

  it('is taken once, and only by its file', () => {
    openSearchHit('/ws/a.md', { type: 'handwriting' }, 1, { text: 'x', case_sensitive: false, whole_word: false }, () => {});
    expect(useFindStore.getState().takeJump('/ws/b.md')).toBeNull();
    expect(useFindStore.getState().takeJump('/ws/a.md')).toMatchObject({ jump: { type: 'handwriting' } });
    expect(useFindStore.getState().takeJump('/ws/a.md')).toBeNull();
  });
});

describe('matchIndex', () => {
  it('is the ordinal among the editor matches, kept in range', () => {
    expect(matchIndex({ type: 'line', line: 0, column: 0, ordinal: 2 }, 5)).toBe(2);
    expect(matchIndex({ type: 'line', line: 0, column: 0, ordinal: 9 }, 5)).toBe(4);
  });

  it('is the first match where the editor has no text for the hit, or nothing to count', () => {
    expect(matchIndex({ type: 'line', line: 0, column: 0, ordinal: null }, 5)).toBe(0);
    expect(matchIndex({ type: 'card', id: 'c' }, 5)).toBe(0);
    expect(matchIndex({ type: 'line', line: 0, column: 0, ordinal: 1 }, 0)).toBe(-1);
  });
});
