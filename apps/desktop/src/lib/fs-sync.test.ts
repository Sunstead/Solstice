import { describe, expect, it } from 'vitest';
import { selfChange } from '@/lib/fs-sync';
import { isSamePath, isWithin, parentOf } from '@/lib/path-utils';

describe('selfChange', () => {
  it('describes a created file as the watcher would', () => {
    expect(selfChange('Created', '/ws/notes/todo.md')).toEqual({
      kind: 'Created',
      path: '/ws/notes/todo.md',
      from: null,
      entry: { name: 'todo.md', path: '/ws/notes/todo.md', is_dir: false },
    });
  });

  it('carries the old path of a rename, and a directory flag', () => {
    const change = selfChange('Renamed', 'C:\\ws\\new', { from: 'C:\\ws\\old', isDir: true });
    expect(change.from).toBe('C:\\ws\\old');
    expect(change.entry).toEqual({ name: 'new', path: 'C:\\ws\\new', is_dir: true });
  });

  it('has no entry once a path is gone', () => {
    expect(selfChange('Removed', '/ws/a.md').entry).toBeNull();
  });
});

describe('path helpers', () => {
  it('compares across separators and trailing slashes', () => {
    expect(isSamePath('C:\\ws\\a', 'C:/ws/a/')).toBe(true);
    expect(isWithin('/ws/notes/a.md', '/ws/notes')).toBe(true);
    expect(isWithin('/ws/notes', '/ws/notes')).toBe(true);
    expect(isWithin('/ws/notes-old/a.md', '/ws/notes')).toBe(false);
  });

  it('finds the parent with either separator', () => {
    expect(parentOf('/ws/notes/a.md')).toBe('/ws/notes');
    expect(parentOf('C:\\ws\\a.md')).toBe('C:\\ws');
    expect(parentOf('a.md')).toBe('');
  });
});
