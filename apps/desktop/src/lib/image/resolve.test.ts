// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  window.matchMedia ??= ((query: string) => ({
    matches: query === '(any-pointer: fine)',
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
});

import { resolveAsset } from './resolve';

const empty = { byPath: new Map(), byName: new Map() } as never;

describe('resolveAsset for a note opened from outside the workspace', () => {
  it('finds a relative image beside the note, where its other editors would', () => {
    const resolved = resolveAsset('img/cat.png', { notePath: '/Downloads/trip/notes.md', workspaceRoot: '/notes' }, empty);
    expect(resolved).toMatchObject({ status: 'resolved', absolutePath: '/Downloads/trip/img/cat.png' });
  });

  it('does so with no workspace open at all', () => {
    const resolved = resolveAsset('../cat.png', { notePath: '/Downloads/trip/notes.md', workspaceRoot: null }, empty);
    expect(resolved).toMatchObject({ status: 'resolved', absolutePath: '/Downloads/cat.png' });
  });
});
