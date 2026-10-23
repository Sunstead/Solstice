import { describe, expect, it } from 'vitest';
import { childrenOf, moveOp, visibleBookmarks } from './view';

const bookmarks = [
  { id: 'a', path: 'A.md' },
  { id: 'gone', path: 'Gone.md' },
  { id: 'b', path: 'B' },
  { id: 'dup', path: 'A.md' },
  { id: 'c', path: 'C.md' },
];
const exists = (rel: string) => rel !== 'Gone.md';

describe('visibleBookmarks', () => {
  it('hides missing targets and duplicates', () => {
    expect(visibleBookmarks(bookmarks, exists).map((b) => b.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('moveOp', () => {
  const visible = visibleBookmarks(bookmarks, exists);
  it('moves after the visible bookmark before the drop', () => {
    expect(moveOp(visible, 0, 2)).toEqual({ op: 'move_bookmark', id: 'a', after: 'c' });
    expect(moveOp(visible, 2, 1)).toEqual({ op: 'move_bookmark', id: 'c', after: 'a' });
  });
  it('to the front is after nothing', () => {
    expect(moveOp(visible, 2, 0)).toEqual({ op: 'move_bookmark', id: 'c', after: null });
  });
  it('a drop where it was is no move', () => {
    expect(moveOp(visible, 1, 1)).toBeNull();
  });
});

describe('childrenOf', () => {
  const index = [
    { name: 'b.md', path: '/ws/N/b.md', is_dir: false },
    { name: 'Sub', path: '/ws/N/Sub', is_dir: true },
    { name: 'a10.md', path: '/ws/N/a10.md', is_dir: false },
    { name: 'a9.md', path: '/ws/N/a9.md', is_dir: false },
    { name: '.hidden', path: '/ws/N/.hidden', is_dir: false },
    { name: 'deep.md', path: '/ws/N/Sub/deep.md', is_dir: false },
    { name: 'other.md', path: '/ws/other.md', is_dir: false },
  ];
  it('lists a folder as the tree does', () => {
    const names = (opts: { showHidden: boolean; foldersFirst: boolean }) =>
      childrenOf(index, '/ws/N', opts).map((e) => e.name);
    expect(names({ showHidden: false, foldersFirst: true })).toEqual(['Sub', 'a9.md', 'a10.md', 'b.md']);
    expect(names({ showHidden: true, foldersFirst: false })).toEqual(['.hidden', 'a9.md', 'a10.md', 'b.md', 'Sub']);
  });
});
