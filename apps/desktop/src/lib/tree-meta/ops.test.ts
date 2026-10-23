import { describe, expect, it } from 'vitest';
import type { TreeMetaOp } from '@/bindings';
import cases from '../../../../../crates/solstice-sync/tests/tree_meta_ops.json';
import { applyOps, fromState, toAbs, toRel, type TreeMetaData } from './ops';

/** The cases `solstice_sync::tree_meta` runs too. */
describe('applyOps', () => {
  for (const c of cases) {
    it(c.name, () => {
      const run = () => applyOps(c.before as TreeMetaData, c.ops as TreeMetaOp[]);
      if ('error' in c && c.error) {
        expect(run).toThrow();
        return;
      }
      expect(run()).toEqual(c.after);
    });
  }

  it('leaves its input alone', () => {
    const before: TreeMetaData = { bookmarks: [{ id: 'a', path: 'A' }], folderColors: {} };
    applyOps(before, [{ op: 'remove_bookmark', path: 'A' }]);
    expect(before.bookmarks).toHaveLength(1);
  });
});

describe('paths', () => {
  it('turns workspace paths into vault paths and back', () => {
    expect(toRel('/ws', '/ws/notes/Plan.md')).toBe('notes/Plan.md');
    expect(toRel('C:\\Users\\me\\ws', 'C:\\Users\\me\\ws\\notes\\Plan.md')).toBe('notes/Plan.md');
    expect(toRel('/ws', '/ws')).toBeNull();
    expect(toRel('/ws', '/wsx/a.md')).toBeNull();
    expect(toAbs('/ws', 'notes/Plan.md')).toBe('/ws/notes/Plan.md');
    expect(toAbs('C:\\ws', 'notes/Plan.md')).toBe('C:\\ws\\notes\\Plan.md');
  });

  it('reads the backend state', () => {
    expect(
      fromState({ linked: true, bookmarks: [{ id: 'a', path: 'A' }], folder_colors: { F: '#ffffff' } }),
    ).toEqual({ bookmarks: [{ id: 'a', path: 'A' }], folderColors: { F: '#ffffff' } });
  });
});
