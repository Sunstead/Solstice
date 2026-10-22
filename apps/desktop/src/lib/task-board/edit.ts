import {
  cardAt,
  colorComment,
  joinLines,
  parseBoard,
  splitLines,
  TASK_ITEM,
  type Board,
  type Card,
  type CardRef,
} from './parse';

/**
 * Board actions as edits of the note's text. Each splices only the lines it
 * touches, keeping the file's line endings and list markers, and returns the
 * text unchanged when what it names isn't there.
 */

function edit(text: string, change: (lines: string[], board: Board) => string[] | null): string {
  const split = splitLines(text);
  const next = change([...split.lines], parseBoard(text));
  // An empty file gets a final newline, as the presets' seeds have.
  return next ? joinLines(next, split.eol, split.finalNewline || text === '') : text;
}

const isBlank = (line: string) => line.trim() === '';

/** Flips the box on `line`, if it holds a task item. */
function flip(line: string): string | null {
  const match = TASK_ITEM.exec(line);
  if (!match) return null;
  const at = match[1].length + match[2].length + match[3].length + 1;
  return line.slice(0, at) + (match[4] === ' ' ? 'x' : ' ') + line.slice(at + 1);
}

export function toggleCard(text: string, ref: CardRef): string {
  return edit(text, (lines, board) => {
    const card = cardAt(board, ref);
    const flipped = card && flip(lines[card.start]);
    if (!card || flipped === null) return null;
    lines[card.start] = flipped;
    return lines;
  });
}

/** Ticks a card's sub-task, by its line. */
export function toggleSubtask(text: string, line: number): string {
  return edit(text, (lines, board) => {
    const owned = board.columns.some((column) => column.cards.some((card) => card.subtasks.some((s) => s.line === line)));
    const flipped = owned ? flip(lines[line]) : null;
    if (flipped === null) return null;
    lines[line] = flipped;
    return lines;
  });
}

/** A card's lines from its markdown: the title on the box's line, the rest indented under it. */
function cardLines(markdown: string, card: Pick<Card, 'indent' | 'marker' | 'contentIndent'>, checked: boolean): string[] {
  const [title, ...rest] = markdown.replace(/\r\n/g, '\n').split('\n');
  const pad = ' '.repeat(card.contentIndent);
  const box = `${' '.repeat(card.indent)}${card.marker} [${checked ? 'x' : ' '}]`;
  return [title ? `${box} ${title}` : box, ...rest.map((line) => (isBlank(line) ? '' : pad + line))];
}

/** Where a card goes at `index` among a column's cards: before one, after the last, or under the heading. */
function cardSlot(board: Board, column: number, index: number): number | null {
  const target = board.columns[column];
  if (!target || index < 0 || index > target.cards.length) return null;
  if (index < target.cards.length) return target.cards[index].start;
  return target.cards.length > 0 ? target.cards[target.cards.length - 1].end : target.heading + 1;
}

/** Moves a card to `to`, its index in the target column once it's there. */
export function moveCard(text: string, from: CardRef, to: CardRef): string {
  const board = parseBoard(text);
  const card = cardAt(board, from);
  if (!card || !board.columns[to.column]) return text;

  const { lines, eol, finalNewline } = splitLines(text);
  const block = lines.splice(card.start, card.end - card.start);
  const without = joinLines(lines, eol, finalNewline);
  const slot = cardSlot(parseBoard(without), to.column, to.card);
  if (slot === null) return text;
  lines.splice(slot, 0, ...block);
  return joinLines(lines, eol, finalNewline);
}

/** Appends a card to a column, in the marker its cards (or the board's) use. */
export function addCard(text: string, column: number, markdown: string): string {
  return edit(text, (lines, board) => {
    const target = board.columns[column];
    if (!target) return null;
    const like = target.cards[target.cards.length - 1] ?? board.columns.flatMap((c) => c.cards)[0];
    const marker = like ? like.marker.replace(/^\d+/, String(target.cards.length + 1)) : '-';
    const indent = like?.indent ?? 0;
    const shape = { indent, marker, contentIndent: indent + marker.length + 1 };
    lines.splice(cardSlot(board, column, target.cards.length)!, 0, ...cardLines(markdown, shape, false));
    return lines;
  });
}

/** Replaces a card's markdown (`cardMarkdown`), keeping its box and marker. */
export function editCard(text: string, ref: CardRef, markdown: string): string {
  return edit(text, (lines, board) => {
    const card = cardAt(board, ref);
    if (!card) return null;
    lines.splice(card.start, card.end - card.start, ...cardLines(markdown, card, card.checked));
    return lines;
  });
}

/** Appends a sub-task to a card, indented to its content. */
export function addSubtask(text: string, ref: CardRef, title: string): string {
  return edit(text, (lines, board) => {
    const card = cardAt(board, ref);
    if (!card) return null;
    lines.splice(card.end, 0, `${' '.repeat(card.contentIndent)}- [ ] ${title}`);
    return lines;
  });
}

/** Takes out a card's sub-task, by its line, with whatever is nested under it. */
export function deleteSubtask(text: string, line: number): string {
  return edit(text, (lines, board) => {
    const card = board.columns.flatMap((c) => c.cards).find((c) => c.subtasks.some((s) => s.line === line));
    if (!card) return null;
    const depth = indentWidth(lines[line]);
    let end = line + 1;
    while (end < card.end && (isBlank(lines[end]) || indentWidth(lines[end]) > depth)) end++;
    while (end > line + 1 && isBlank(lines[end - 1])) end--;
    lines.splice(line, end - line);
    return lines;
  });
}

const indentWidth = (line: string) => line.length - line.trimStart().length;

export function deleteCard(text: string, ref: CardRef): string {
  return edit(text, (lines, board) => {
    const card = cardAt(board, ref);
    if (!card) return null;
    lines.splice(card.start, card.end - card.start);
    return lines;
  });
}

/** Puts `section` in at `at`, with a blank line either side where there isn't one. */
function insertSection(lines: string[], at: number, section: string[]) {
  const before = at > 0 && !isBlank(lines[at - 1]) ? [''] : [];
  const after = at < lines.length && !isBlank(lines[at]) ? [''] : [];
  lines.splice(at, 0, ...before, ...section, ...after);
}

/** Takes a column out, heading to the next column; returns its lines without trailing blanks. */
function takeSection(lines: string[], board: Board, column: number): string[] {
  const { heading, end } = board.columns[column];
  const section = lines.splice(heading, end - heading);
  // At the file's end, the blank lines that set it apart go with it.
  if (heading === lines.length) while (lines.length > 0 && isBlank(lines[lines.length - 1])) lines.pop();
  while (section.length > 1 && isBlank(section[section.length - 1])) section.pop();
  return section;
}

/** Where the columns end: after the last one, before anything a `#` heading starts. */
function columnsEnd(board: Board, lines: string[]): number {
  return board.columns[board.columns.length - 1]?.end ?? lines.length;
}

export function addColumn(text: string, name: string): string {
  return edit(text, (lines, board) => {
    insertSection(lines, columnsEnd(board, lines), [`## ${name}`]);
    return lines;
  });
}

export function renameColumn(text: string, column: number, name: string): string {
  return edit(text, (lines, board) => {
    const target = board.columns[column];
    if (!target) return null;
    lines[target.heading] = `## ${name}${colorComment(target.color)}`;
    return lines;
  });
}

/** Tints a column: a canvas preset number (`1`–`6`), a hex colour, or null for none. */
export function setColumnColor(text: string, column: number, color: string | null): string {
  return edit(text, (lines, board) => {
    const target = board.columns[column];
    if (!target) return null;
    lines[target.heading] = `## ${target.name}${colorComment(color)}`;
    return lines;
  });
}

export function deleteColumn(text: string, column: number): string {
  return edit(text, (lines, board) => {
    if (!board.columns[column]) return null;
    takeSection(lines, board, column);
    return lines;
  });
}

/** Moves a column, with all it holds, to `to`: its index once it's there. */
export function moveColumn(text: string, from: number, to: number): string {
  const board = parseBoard(text);
  if (!board.columns[from] || to < 0 || to >= board.columns.length || from === to) return text;

  const split = splitLines(text);
  const section = takeSection(split.lines, board, from);
  const without = joinLines(split.lines, split.eol, split.finalNewline);
  return edit(without, (rest, after) => {
    const at = to < after.columns.length ? after.columns[to].heading : columnsEnd(after, rest);
    insertSection(rest, at, section);
    return rest;
  });
}
