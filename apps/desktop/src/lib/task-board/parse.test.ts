import { describe, expect, it } from 'vitest';

import { cardMarkdown, parseBoard, plainTitle } from './parse';

const names = (text: string) => parseBoard(text).columns.map((c) => c.name);
const titles = (text: string, column = 0) => parseBoard(text).columns[column].cards.map((c) => c.title);

describe('parseBoard', () => {
  it('makes a column of every ## heading and a card of every top-level checkbox', () => {
    const board = parseBoard('## To Do\n- [ ] Milk\n- [x] Eggs\n\n## Done\n- [X] Bread\n');
    expect(board.columns.map((c) => c.name)).toEqual(['To Do', 'Done']);
    expect(board.columns[0].cards).toMatchObject([
      { title: 'Milk', checked: false, start: 1, end: 2 },
      { title: 'Eggs', checked: true, start: 2, end: 3 },
    ]);
    expect(board.columns[1].cards[0]).toMatchObject({ title: 'Bread', checked: true });
    expect(board.columns[0]).toMatchObject({ heading: 0, end: 4 });
  });

  it('takes a # heading above the columns as the title', () => {
    const board = parseBoard('# Relaunch\n\nIntro\n\n## To Do\n- [ ] Copy\n');
    expect(board.title).toBe('Relaunch');
    expect(names('# Relaunch\n## A\n')).toEqual(['A']);
    expect(parseBoard('## A\n').title).toBeNull();
  });

  it('strips closing hashes and spaces from heading names', () => {
    expect(names('##   Doing  ##\n')).toEqual(['Doing']);
    expect(names('##\n')).toEqual(['']);
  });

  it('ends a column at the next # or ## heading, keeping deeper ones inside', () => {
    const board = parseBoard('## A\n- [ ] a\n### Later\n- [ ] b\n# Archive\n- [ ] c\n');
    expect(board.columns).toHaveLength(1);
    expect(board.columns[0].cards.map((c) => c.title)).toEqual(['a', 'b']);
    expect(board.columns[0].end).toBe(4);
  });

  it('ignores headings and checkboxes in code fences and front matter', () => {
    const text = '---\ntitle: x\n---\n## A\n```\n## Not a column\n- [ ] not a card\n```\n- [ ] real\n';
    const board = parseBoard(text);
    expect(board.columns.map((c) => c.name)).toEqual(['A']);
    expect(board.columns[0].heading).toBe(3);
    expect(board.columns[0].cards.map((c) => c.title)).toEqual(['real']);
    expect(names('---\n## nope\n---\n')).toEqual([]);
  });

  it('leaves plain bullets and paragraphs out', () => {
    expect(titles('## A\nSome notes\n- plain\n- [ ] card\n1. [ ] numbered\n* [ ] star\n')).toEqual([
      'card',
      'numbered',
      'star',
    ]);
  });

  it('keeps nested lines with their card, blank lines inside included', () => {
    const text = '## A\n- [ ] Trip\n  - [x] Book\n  - [ ] Pack\n\n  Notes here\n\n- [ ] Next\n';
    const [trip, next] = parseBoard(text).columns[0].cards;
    expect(trip).toMatchObject({ start: 1, end: 6, title: 'Trip' });
    expect(trip.body).toBe('- [x] Book\n- [ ] Pack\n\nNotes here');
    expect(trip.subtasks).toEqual([
      { line: 2, checked: true, text: 'Book' },
      { line: 3, checked: false, text: 'Pack' },
    ]);
    expect(next).toMatchObject({ start: 7, end: 8 });
    expect(cardMarkdown(trip)).toBe('Trip\n- [x] Book\n- [ ] Pack\n\nNotes here');
    expect(cardMarkdown(next)).toBe('Next');
  });

  it('ends a card at an unindented line', () => {
    const [card] = parseBoard('## A\n- [ ] One\nnot indented\n').columns[0].cards;
    expect(card.end).toBe(2);
  });

  it('measures the content indent from the marker', () => {
    const [card] = parseBoard('## A\n10. [ ] Ten\n    more\n').columns[0].cards;
    expect(card).toMatchObject({ marker: '10.', indent: 0, contentIndent: 4, end: 3, body: 'more' });
  });

  it('reads CRLF files and remembers their line ending', () => {
    const board = parseBoard('## A\r\n- [ ] Milk\r\n');
    expect(board.eol).toBe('\r\n');
    expect(board.columns[0].cards[0].title).toBe('Milk');
    expect(parseBoard('## A\n').eol).toBe('\n');
  });

  it('has no columns for an empty or heading-less note', () => {
    expect(parseBoard('').columns).toEqual([]);
    expect(parseBoard('- [ ] loose\n').columns).toEqual([]);
  });
});

describe('plainTitle', () => {
  it('drops markdown for a title shown as text', () => {
    expect(plainTitle('Paint the [[notes/Plan]] room')).toBe('Paint the Plan room');
    expect(plainTitle('See [[Plan#Rooms|the plan]]')).toBe('See the plan');
    expect(plainTitle('Clean **gutters** and _drains_')).toBe('Clean gutters and drains');
    expect(plainTitle('Read [the docs](https://x.y) `now` ==today==')).toBe('Read the docs now today');
    expect(plainTitle('snake_case_name stays')).toBe('snake_case_name stays');
  });
});

describe('column colours', () => {
  it('reads a colour comment off the heading', () => {
    const board = parseBoard('## To Do %%color: red%%\n## Doing %%color: #3366ff%%\n## Done\n## Odd %%color: puce%%\n');
    expect(board.columns.map((c) => [c.name, c.color])).toEqual([
      ['To Do', '1'],
      ['Doing', '#3366ff'],
      ['Done', null],
      ['Odd', null],
    ]);
  });

  it('takes a preset by number too', () => {
    expect(parseBoard('## A %%color:4%%\n').columns[0].color).toBe('4');
  });
});

describe('card notes', () => {
  it('are the nested lines that aren’t sub-tasks', () => {
    const [card] = parseBoard('## A\n- [ ] Trip\n  Pack light\n  - [ ] Book\n  - plain\n').columns[0].cards;
    expect(card.notes).toBe('Pack light\n- plain');
  });
});
