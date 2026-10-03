import { describe, expect, it } from 'vitest';
import { buildSnapshot, resolveWikilink, shortestWikilinkTarget } from '@/lib/stores/wikilink-index';

// The resolution order Solstice Sync's Rust port must match: exact path, then
// the path without its implicit extension, then the bare name.
const index = buildSnapshot([
  'todo.md',
  'notes/Spec.md',
  'notes/ideas.md',
  'archive/ideas.md',
  'boards/plan.canvas',
  'images/diagram.png',
]);

describe('resolveWikilink', () => {
  it('resolves an exact path, extension included', () => {
    expect(resolveWikilink('notes/ideas.md', index)).toEqual({ status: 'resolved', path: 'notes/ideas.md' });
    expect(resolveWikilink('images/diagram.png', index)).toEqual({ status: 'resolved', path: 'images/diagram.png' });
  });

  it('resolves a path without its implicit extension', () => {
    expect(resolveWikilink('archive/ideas', index)).toEqual({ status: 'resolved', path: 'archive/ideas.md' });
    expect(resolveWikilink('boards/plan', index)).toEqual({ status: 'resolved', path: 'boards/plan.canvas' });
  });

  it('resolves a bare name while it is unique', () => {
    expect(resolveWikilink('todo', index)).toEqual({ status: 'resolved', path: 'todo.md' });
    expect(resolveWikilink('plan', index)).toEqual({ status: 'resolved', path: 'boards/plan.canvas' });
  });

  it('reports a bare name two files share as ambiguous, in path order', () => {
    expect(resolveWikilink('ideas', index)).toEqual({
      status: 'ambiguous',
      candidates: ['archive/ideas.md', 'notes/ideas.md'],
    });
  });

  it('matches case-insensitively and keeps the real path', () => {
    expect(resolveWikilink('SPEC', index)).toEqual({ status: 'resolved', path: 'notes/Spec.md' });
    expect(resolveWikilink('Notes/spec', index)).toEqual({ status: 'resolved', path: 'notes/Spec.md' });
  });

  it('normalizes the target first', () => {
    expect(resolveWikilink(' ./notes\\Spec ', index)).toEqual({ status: 'resolved', path: 'notes/Spec.md' });
  });

  it('leaves unknown and empty targets unresolved', () => {
    expect(resolveWikilink('missing', index)).toEqual({ status: 'unresolved' });
    expect(resolveWikilink('notes/todo', index)).toEqual({ status: 'unresolved' });
    expect(resolveWikilink('  ', index)).toEqual({ status: 'unresolved' });
  });
});

describe('shortestWikilinkTarget', () => {
  it('uses the bare name where unique, the path otherwise', () => {
    expect(shortestWikilinkTarget('notes/Spec.md', index)).toBe('Spec');
    expect(shortestWikilinkTarget('notes/ideas.md', index)).toBe('notes/ideas');
  });
});
