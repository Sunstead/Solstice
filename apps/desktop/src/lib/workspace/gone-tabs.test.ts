import { describe, expect, it } from 'vitest';

import { goneTabs } from './gone-tabs';

const known = [{ path: '/notes/a.md' }, { path: '/notes/sub/b.md' }];

describe('goneTabs', () => {
  it('finds workspace tabs whose files the index no longer has', async () => {
    const gone = await goneTabs(['/notes/a.md', '/notes/c.md'], known, '/notes', async () => true);
    expect(gone).toEqual(['/notes/c.md']);
  });

  it('asks the disk about a file outside the workspace, which no index has', async () => {
    const onDisk = new Set(['/Downloads/kept.md']);
    const gone = await goneTabs(
      ['/Downloads/kept.md', '/Downloads/deleted.md'],
      known,
      '/notes',
      async (path) => onDisk.has(path),
    );
    expect(gone).toEqual(['/Downloads/deleted.md']);
  });

  it('treats a sibling folder that starts with the same name as outside', async () => {
    const gone = await goneTabs(['/notes-old/x.md'], known, '/notes', async () => true);
    expect(gone).toEqual([]);
  });
});
