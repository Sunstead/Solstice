import { describe, expect, it } from 'vitest';

import {
  addCard,
  addColumn,
  addSubtask,
  deleteCard,
  deleteSubtask,
  deleteColumn,
  editCard,
  moveCard,
  moveColumn,
  renameColumn,
  setColumnColor,
  toggleCard,
  toggleSubtask,
} from './edit';

const BOARD = [
  '---',
  'tags: [home]',
  '---',
  '# House',
  '',
  'Things to do.',
  '',
  '## To Do',
  'A note about this column.',
  '',
  '- [ ] Paint',
  '  - [ ] Buy paint',
  '  - [x] Tape',
  '- [ ] Clean',
  '',
  '## Doing',
  '',
  '## Done',
  '* [x] Plan',
  '',
].join('\n');

describe('card edits', () => {
  it('ticks and unticks a card, touching only its box', () => {
    const ticked = toggleCard(BOARD, { column: 0, card: 1 });
    expect(ticked).toBe(BOARD.replace('- [ ] Clean', '- [x] Clean'));
    expect(toggleCard(ticked, { column: 0, card: 1 })).toBe(BOARD);
    expect(toggleCard(BOARD, { column: 2, card: 0 })).toBe(BOARD.replace('* [x] Plan', '* [ ] Plan'));
  });

  it('ticks a sub-task by its line', () => {
    expect(toggleSubtask(BOARD, 11)).toBe(BOARD.replace('  - [ ] Buy paint', '  - [x] Buy paint'));
    expect(toggleSubtask(BOARD, 12)).toBe(BOARD.replace('  - [x] Tape', '  - [ ] Tape'));
    expect(toggleSubtask(BOARD, 8)).toBe(BOARD);
  });

  it('moves a card with its nested lines into another column', () => {
    const moved = moveCard(BOARD, { column: 0, card: 0 }, { column: 2, card: 1 });
    expect(moved).toBe(
      BOARD.replace('- [ ] Paint\n  - [ ] Buy paint\n  - [x] Tape\n', '').replace(
        '* [x] Plan\n',
        '* [x] Plan\n- [ ] Paint\n  - [ ] Buy paint\n  - [x] Tape\n',
      ),
    );
  });

  it('moves a card into an empty column, right under its heading', () => {
    const moved = moveCard(BOARD, { column: 0, card: 1 }, { column: 1, card: 0 });
    expect(moved).toBe(BOARD.replace('- [ ] Clean\n', '').replace('## Doing\n', '## Doing\n- [ ] Clean\n'));
  });

  it('moves a card to the top of another column', () => {
    const moved = moveCard(BOARD, { column: 0, card: 1 }, { column: 2, card: 0 });
    expect(moved).toBe(BOARD.replace('- [ ] Clean\n', '').replace('* [x] Plan', '- [ ] Clean\n* [x] Plan'));
  });

  it('reorders within a column, by the index it ends up at', () => {
    const down = moveCard(BOARD, { column: 0, card: 0 }, { column: 0, card: 1 });
    expect(down).toBe(
      BOARD.replace('- [ ] Paint\n  - [ ] Buy paint\n  - [x] Tape\n- [ ] Clean', '- [ ] Clean\n- [ ] Paint\n  - [ ] Buy paint\n  - [x] Tape'),
    );
    expect(moveCard(down, { column: 0, card: 1 }, { column: 0, card: 0 })).toBe(BOARD);
    expect(moveCard(BOARD, { column: 0, card: 1 }, { column: 0, card: 1 })).toBe(BOARD);
  });

  it('adds a card at the bottom of its column, in the column’s marker', () => {
    expect(addCard(BOARD, 0, 'Fix door')).toBe(BOARD.replace('- [ ] Clean\n', '- [ ] Clean\n- [ ] Fix door\n'));
    expect(addCard(BOARD, 2, 'Review')).toBe(BOARD.replace('* [x] Plan\n', '* [x] Plan\n* [ ] Review\n'));
    expect(addCard(BOARD, 1, 'Sand')).toBe(BOARD.replace('## Doing\n', '## Doing\n- [ ] Sand\n'));
  });

  it('indents a new card’s further lines under it', () => {
    expect(addCard('## A\n', 0, 'Trip\n- [ ] Pack\n\nnotes')).toBe('## A\n- [ ] Trip\n  - [ ] Pack\n\n  notes\n');
  });

  it('adds a card to a column at the end of a file with no final newline', () => {
    expect(addCard('## A\n- [ ] x', 0, 'y')).toBe('## A\n- [ ] x\n- [ ] y');
  });

  it('edits a card’s markdown, keeping its box and marker', () => {
    const edited = editCard(BOARD, { column: 0, card: 0 }, 'Paint walls\n- [ ] Buy paint');
    expect(edited).toBe(BOARD.replace('- [ ] Paint\n  - [ ] Buy paint\n  - [x] Tape', '- [ ] Paint walls\n  - [ ] Buy paint'));
    expect(editCard(BOARD, { column: 2, card: 0 }, 'Plan it')).toBe(BOARD.replace('* [x] Plan', '* [x] Plan it'));
  });

  it('deletes a card and its nested lines', () => {
    expect(deleteCard(BOARD, { column: 0, card: 0 })).toBe(BOARD.replace('- [ ] Paint\n  - [ ] Buy paint\n  - [x] Tape\n', ''));
  });

  it('leaves the text alone for a card that isn’t there', () => {
    expect(toggleCard(BOARD, { column: 1, card: 0 })).toBe(BOARD);
    expect(deleteCard(BOARD, { column: 9, card: 0 })).toBe(BOARD);
    expect(moveCard(BOARD, { column: 0, card: 5 }, { column: 1, card: 0 })).toBe(BOARD);
  });

  it('keeps CRLF line endings', () => {
    const crlf = '## A\r\n- [ ] x\r\n\r\n## B\r\n';
    expect(moveCard(crlf, { column: 0, card: 0 }, { column: 1, card: 0 })).toBe('## A\r\n\r\n## B\r\n- [ ] x\r\n');
    expect(addCard(crlf, 0, 'y\nz')).toBe('## A\r\n- [ ] x\r\n- [ ] y\r\n  z\r\n\r\n## B\r\n');
  });
});

describe('column edits', () => {
  it('appends a column after the last one', () => {
    expect(addColumn(BOARD, 'Blocked')).toBe(`${BOARD}\n## Blocked\n`);
    expect(addColumn('', 'To Do')).toBe('## To Do\n');
    expect(addColumn('# Title', 'To Do')).toBe('# Title\n\n## To Do');
  });

  it('adds a column before a # section that follows the columns', () => {
    expect(addColumn('## A\n- [ ] a\n\n# Archive\nold\n', 'B')).toBe('## A\n- [ ] a\n\n## B\n\n# Archive\nold\n');
  });

  it('renames a column', () => {
    expect(renameColumn(BOARD, 1, 'In progress')).toBe(BOARD.replace('## Doing', '## In progress'));
  });

  it('deletes a column with everything under it', () => {
    expect(deleteColumn(BOARD, 0)).toBe(
      BOARD.replace('## To Do\nA note about this column.\n\n- [ ] Paint\n  - [ ] Buy paint\n  - [x] Tape\n- [ ] Clean\n\n', ''),
    );
    expect(deleteColumn(BOARD, 2)).toBe(BOARD.replace('\n## Done\n* [x] Plan\n', ''));
  });

  it('moves a whole section, hidden text included', () => {
    const doneFirst = moveColumn(BOARD, 2, 0);
    expect(doneFirst).toBe(
      [
        '---',
        'tags: [home]',
        '---',
        '# House',
        '',
        'Things to do.',
        '',
        '## Done',
        '* [x] Plan',
        '',
        '## To Do',
        'A note about this column.',
        '',
        '- [ ] Paint',
        '  - [ ] Buy paint',
        '  - [x] Tape',
        '- [ ] Clean',
        '',
        '## Doing',
        '',
      ].join('\n'),
    );
    expect(moveColumn(doneFirst, 0, 2)).toBe(BOARD);
    expect(moveColumn(BOARD, 1, 1)).toBe(BOARD);
  });
});

describe('sub-task edits', () => {
  const TEXT = '## A\n- [ ] Trip\n  - [ ] Book\n- [ ] Next\n';

  it('appends a sub-task under the card', () => {
    expect(addSubtask(TEXT, { column: 0, card: 0 }, 'Pack')).toBe('## A\n- [ ] Trip\n  - [ ] Book\n  - [ ] Pack\n- [ ] Next\n');
    expect(addSubtask(TEXT, { column: 0, card: 1 }, 'Go')).toBe(`${TEXT}  - [ ] Go\n`);
  });

  it('indents a sub-task to the card’s content', () => {
    expect(addSubtask('## A\n1. [ ] One\n', { column: 0, card: 0 }, 'x')).toBe('## A\n1. [ ] One\n   - [ ] x\n');
  });

  it('deletes a sub-task by its line, with what’s nested under it', () => {
    const nested = '## A\n- [ ] Trip\n  - [ ] Book\n    - [ ] Hotel\n  - [ ] Pack\n';
    expect(deleteSubtask(nested, 2)).toBe('## A\n- [ ] Trip\n  - [ ] Pack\n');
    expect(deleteSubtask(nested, 1)).toBe(nested);
  });
});

describe('column colour edits', () => {
  it('sets, changes and clears a column’s colour', () => {
    const red = setColumnColor('## A\n- [ ] x\n', 0, '1');
    expect(red).toBe('## A %%color: red%%\n- [ ] x\n');
    expect(setColumnColor(red, 0, '#336699')).toBe('## A %%color: #336699%%\n- [ ] x\n');
    expect(setColumnColor(red, 0, null)).toBe('## A\n- [ ] x\n');
  });

  it('keeps the colour through a rename', () => {
    expect(renameColumn('## A %%color: red%%\n', 0, 'B')).toBe('## B %%color: red%%\n');
  });
});
