import { describe, expect, it } from 'vitest';

import { buildSnapshot } from '@/lib/stores/wikilink-index';
import { rankWikilinkTargets, stepSuggest, suggestedLink, suggestEnd, wikilinkQuery } from './suggest';

describe('wikilinkQuery', () => {
  it('finds an unclosed [[ before the caret', () => {
    expect(wikilinkQuery('See [[Pla')).toEqual({ offset: 4, query: 'Pla' });
    expect(wikilinkQuery('[[')).toEqual({ offset: 0, query: '' });
    expect(wikilinkQuery('An embed ![[pic')).toEqual({ offset: 10, query: 'pic' });
    expect(wikilinkQuery('[[Projects/Pl')).toEqual({ offset: 0, query: 'Projects/Pl' });
  });

  it('stays out of closed links, headings and aliases', () => {
    expect(wikilinkQuery('[[Plan]] and')).toBeNull();
    expect(wikilinkQuery('[[Plan#Goa')).toBeNull();
    expect(wikilinkQuery('[[Plan|the pl')).toBeNull();
    expect(wikilinkQuery('a [single')).toBeNull();
    expect(wikilinkQuery('plain text')).toBeNull();
  });
});

describe('rankWikilinkTargets', () => {
  const paths = [
    'Archive/Plan old.md',
    'Planning.canvas',
    'Plan.pdf',
    'Projects/Plan.md',
    'Work/Daily plan.md',
    'Explanation.md',
    'Board.task.md',
    'pics/plant.png',
  ];

  it('ranks by how well the name matches, notes first within each', () => {
    expect(rankWikilinkTargets(paths, 'plan')).toEqual([
      // The name itself: the note before the PDF.
      'Projects/Plan.md',
      'Plan.pdf',
      // Names starting with it.
      'Archive/Plan old.md',
      'Planning.canvas',
      'pics/plant.png',
      // A later word in the name.
      'Work/Daily plan.md',
      // Anywhere in the name.
      'Explanation.md',
    ]);
  });

  it('matches folders in the path, and letters in order last', () => {
    expect(rankWikilinkTargets(paths, 'projects/')).toEqual(['Projects/Plan.md']);
    expect(rankWikilinkTargets(paths, 'brd')).toEqual(['Board.task.md']);
  });

  it('lists every file, notes first, for an empty query', () => {
    const all = rankWikilinkTargets(paths, '');
    expect(all).toHaveLength(paths.length);
    expect(all.slice(0, 5).every((p) => p.endsWith('.md'))).toBe(true);
    expect(rankWikilinkTargets(paths, '', 2)).toHaveLength(2);
  });
});

describe('stepSuggest', () => {
  const closed = { open: null, dismissed: null };
  const at = { from: 4, query: 'Pl' };
  const same = (pos: number) => pos;

  it('opens on typing, not on moving the caret into a link', () => {
    expect(stepSuggest(closed, { at, docChanged: true, map: same }).open).toEqual(at);
    expect(stepSuggest(closed, { at, docChanged: false, map: same }).open).toBeNull();
  });

  it('follows the caret while open, and closes when it leaves', () => {
    const open = { open: at, dismissed: null };
    expect(stepSuggest(open, { at: { from: 4, query: 'P' }, docChanged: false, map: same }).open).toEqual({
      from: 4,
      query: 'P',
    });
    expect(stepSuggest(open, { at: null, docChanged: false, map: same })).toEqual(closed);
  });

  it('stays closed after Escape until that link is left', () => {
    const open = { open: at, dismissed: null };
    const dismissed = stepSuggest(open, { at, docChanged: false, close: true, map: same });
    expect(dismissed).toEqual({ open: null, dismissed: 4 });
    // Typing on, with the [[ moved by an edit before it.
    const moved = stepSuggest(dismissed, { at: { from: 6, query: 'Pla' }, docChanged: true, map: (p) => p + 2 });
    expect(moved).toEqual({ open: null, dismissed: 6 });
    expect(stepSuggest(moved, { at: null, docChanged: true, map: same })).toEqual(closed);
  });
});

describe('choosing a suggestion', () => {
  it('takes the paired ]] with it, when there is one', () => {
    expect(suggestEnd(6, ']] and on')).toBe(8);
    expect(suggestEnd(6, ' and on')).toBe(6);
  });

  it('writes the shortest link that finds only that file', () => {
    const index = buildSnapshot(['Projects/Plan.md', 'Archive/Plan.md', 'Ideas.md', 'pic.png']);
    expect(suggestedLink('Ideas.md', index)).toBe('[[Ideas]]');
    expect(suggestedLink('Projects/Plan.md', index)).toBe('[[Projects/Plan]]');
    expect(suggestedLink('pic.png', index)).toBe('[[pic.png]]');
  });
});
