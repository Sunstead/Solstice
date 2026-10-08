import { describe, expect, it } from 'vitest';
import {
  EMBED_SOURCE,
  indexKey,
  normalizeTarget,
  parseWikilinkTarget,
  stripExtension,
  WIKILINK_SOURCE,
  wikilinkLabel,
} from '@/lib/wikilink/target';

describe('wikilink targets', () => {
  it('normalizes hand-written targets', () => {
    expect(normalizeTarget(' ./notes\\todo.md ')).toBe('notes/todo.md');
    expect(normalizeTarget('/notes//sub/')).toBe('notes/sub');
    expect(normalizeTarget('todo')).toBe('todo');
  });

  it('keys case-insensitively', () => {
    expect(indexKey('Notes/ToDo.md')).toBe(indexKey('notes/todo.md'));
  });

  it('drops only the implicit extensions', () => {
    expect(stripExtension('notes/todo.md')).toBe('notes/todo');
    expect(stripExtension('board.canvas')).toBe('board');
    expect(stripExtension('paper.pdf')).toBe('paper');
    expect(stripExtension('photo.png')).toBe('photo.png');
    expect(stripExtension('v1.2/notes')).toBe('v1.2/notes');
  });

  it('labels a target by its bare name', () => {
    expect(wikilinkLabel('notes/todo.md')).toBe('todo');
  });

  it('splits path, heading and suffix', () => {
    expect(parseWikilinkTarget('notes/spec#Design|400')).toEqual({
      path: 'notes/spec',
      heading: 'Design',
      block: null,
      suffix: '400',
    });
    expect(parseWikilinkTarget('#here')).toEqual({ path: '', heading: 'here', block: null, suffix: null });
    expect(parseWikilinkTarget('todo|the list')).toEqual({ path: 'todo', heading: null, block: null, suffix: 'the list' });
    expect(parseWikilinkTarget('todo#')).toEqual({ path: 'todo', heading: null, block: null, suffix: null });
    // The same cases as solstice-core's `parse_target`.
    expect(parseWikilinkTarget('notes/spec#^a1b2|Alias')).toEqual({
      path: 'notes/spec',
      heading: null,
      block: 'a1b2',
      suffix: 'Alias',
    });
    expect(parseWikilinkTarget('todo#^').block).toBeNull();
  });

  it('tells links from embeds', () => {
    const links = (s: string) => [...s.matchAll(new RegExp(WIKILINK_SOURCE, 'g'))].map((m) => m[1]);
    const embeds = (s: string) => [...s.matchAll(new RegExp(EMBED_SOURCE, 'g'))].map((m) => m[1]);
    const text = 'See [[todo]] and ![[diagram.png]], not [[a\nb]] or [[x[y]].';
    expect(links(text)).toEqual(['todo']);
    expect(embeds(text)).toEqual(['diagram.png']);
  });
});
