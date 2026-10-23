import { describe, expect, it } from 'vitest';
import type { FsChange } from '@/bindings';
import { opsFromWatcher } from './watcher';

const renamed = (from: string, to: string, isDir: boolean): FsChange => ({
  kind: 'Renamed',
  path: to,
  from,
  entry: { name: to.split('/').pop()!, path: to, is_dir: isDir },
});

describe('opsFromWatcher', () => {
  it('carries any rename in a folder that is not synced', () => {
    expect(opsFromWatcher([renamed('/ws/a.md', '/ws/b.md', false)], '/ws', false)).toEqual([
      { op: 'retarget', from: 'a.md', to: 'b.md' },
    ]);
  });

  it('in a synced folder, carries only folder renames', () => {
    // Sync renames files one by one on the devices it reaches, and the
    // device that renamed them already moved the bookmark.
    expect(opsFromWatcher([renamed('/ws/a.md', '/ws/b.md', false)], '/ws', true)).toEqual([]);
    expect(opsFromWatcher([renamed('/ws/A', '/ws/B', true)], '/ws', true)).toEqual([
      { op: 'retarget', from: 'A', to: 'B' },
    ]);
  });

  it('never forgets on a removal, and ignores what is outside the workspace', () => {
    const removed: FsChange = { kind: 'Removed', path: '/ws/a.md', from: null, entry: null };
    expect(opsFromWatcher([removed], '/ws', false)).toEqual([]);
    expect(opsFromWatcher([renamed('/elsewhere/a', '/ws/b', true)], '/ws', false)).toEqual([]);
    expect(opsFromWatcher([renamed('/ws/.hidden', '/ws/b', true)], '/ws', false)).toEqual([]);
  });
});
