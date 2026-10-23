import { describe, expect, it } from 'vitest';

import type { FileEntry } from '@/bindings';
import { matchNames } from './names';

const file = (path: string): FileEntry => ({ path, name: path.split('/').pop()!, is_dir: false });
const files = [
  file('/ws/Biology/Cells.md'),
  file('/ws/Biology/Cell membrane.md'),
  file('/ws/Excellent.md'),
  file('/ws/cell.pdf'),
  file('/ws/Other.md'),
];
const loose = { caseSensitive: false, wholeWord: false };

describe('matchNames', () => {
  it('finds names containing the query, those starting with it first, then shorter, then by path', () => {
    const { matches, total } = matchNames(files, 'cell', loose, 10);
    expect(total).toBe(4);
    expect(matches.map((m) => m.entry.name)).toEqual(['Cells.md', 'cell.pdf', 'Cell membrane.md', 'Excellent.md']);
  });

  it('marks where the name matches', () => {
    const [first] = matchNames([file('/ws/Excellent.md')], 'cell', loose, 10).matches;
    expect(first.range).toEqual([2, 6]);
  });

  it('follows the case and whole-word options', () => {
    expect(matchNames(files, 'Cell', { caseSensitive: true, wholeWord: false }, 10).total).toBe(2);
    const words = matchNames(files, 'cell', { caseSensitive: false, wholeWord: true }, 10);
    expect(words.matches.map((m) => m.entry.name)).toEqual(['cell.pdf', 'Cell membrane.md']);
  });

  it('caps what it returns, not what it counts', () => {
    const { matches, total } = matchNames(files, 'cell', loose, 2);
    expect(matches).toHaveLength(2);
    expect(total).toBe(4);
  });

  it('finds nothing for nothing', () => {
    expect(matchNames(files, '', loose, 10)).toEqual({ matches: [], total: 0 });
  });

  it('leaves folders out', () => {
    expect(matchNames([{ path: '/ws/Cells', name: 'Cells', is_dir: true }], 'cell', loose, 10).total).toBe(0);
  });
});
