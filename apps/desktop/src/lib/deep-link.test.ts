import { describe, expect, it } from 'vitest';
import { parseDeepLink, workspacesForVault } from '@/lib/deep-link';

describe('parseDeepLink', () => {
  it('reads the vault and path', () => {
    expect(parseDeepLink('solstice://open?vault=Notes&path=projects%2Fatlas.md')).toEqual({
      vault: 'Notes',
      path: 'projects/atlas.md',
    });
    expect(parseDeepLink('solstice:open?vault=Notes&path=todo.md')).toEqual({ vault: 'Notes', path: 'todo.md' });
  });

  it('normalizes the path', () => {
    expect(parseDeepLink('solstice://open?vault=v&path=.%2Fa%5Cb.md')).toEqual({ vault: 'v', path: 'a/b.md' });
  });

  it('refuses paths that leave the vault', () => {
    expect(parseDeepLink('solstice://open?vault=v&path=..%2Fsecret.md')).toBeNull();
    expect(parseDeepLink('solstice://open?vault=v&path=a%2F..%2F..%2Fb.md')).toBeNull();
    expect(parseDeepLink('solstice://open?vault=v&path=C%3A%2Fwin.ini')).toBeNull();
  });

  it('refuses other schemes, actions and missing parts', () => {
    expect(parseDeepLink('https://open?vault=v&path=a.md')).toBeNull();
    expect(parseDeepLink('solstice://delete?vault=v&path=a.md')).toBeNull();
    expect(parseDeepLink('solstice://open?vault=v')).toBeNull();
    expect(parseDeepLink('solstice://open?path=a.md')).toBeNull();
    expect(parseDeepLink('not a url')).toBeNull();
  });
});

describe('workspacesForVault', () => {
  const known = [
    { path: '/home/me/Notes', name: 'Notes', lastOpenedAt: 1 },
    { path: 'C:\\Users\\me\\notes\\', name: 'notes', lastOpenedAt: 3 },
    { path: '/home/me/Work', name: 'Work', lastOpenedAt: 2 },
  ];

  it('matches the folder name, case-insensitively, newest first', () => {
    expect(workspacesForVault('notes', known).map((w) => w.lastOpenedAt)).toEqual([3, 1]);
    expect(workspacesForVault('Work', known)).toHaveLength(1);
    expect(workspacesForVault('Other', known)).toEqual([]);
  });
});
