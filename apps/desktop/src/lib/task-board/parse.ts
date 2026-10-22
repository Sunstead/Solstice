import { splitFrontMatter } from '@/lib/frontmatter/split';
import { wikilinkLabel } from '@/lib/wikilink/target';

/**
 * A task board is a note (`*.task.md`): each `##` heading is a column and
 * each top-level checkbox item under it a card; a `#` heading above the
 * columns is the board's title. Everything else stays in the file, unseen.
 *
 * The board is read by lines rather than through the editor's parser, since
 * every edit (`edit.ts`) is a splice of the lines it touches: the rest of the
 * note keeps its bytes, and a synced board merges like any note.
 */

export interface Subtask {
  /** Its line in the file. */
  line: number;
  checked: boolean;
  text: string;
}

export interface Card {
  checked: boolean;
  /** Its lines in the file, `end` exclusive: the item and what's nested under it. */
  start: number;
  end: number;
  /** The first line's text, after the checkbox. */
  title: string;
  /** The nested lines, unindented by `contentIndent`. */
  body: string;
  /** `body` without its sub-task lines: what the card shows as text. */
  notes: string;
  subtasks: Subtask[];
  /** The list marker: `-`, `*`, `+` or `1.`. */
  marker: string;
  /** Spaces before the marker. */
  indent: number;
  /** Where the item's content starts, which nested lines are indented to. */
  contentIndent: number;
}

export interface Column {
  /** The heading's text, without its colour comment. */
  name: string;
  /** A canvas preset (`1`–`6`) or a hex colour, from `%%color: red%%` on the heading. */
  color: string | null;
  /** The heading's line. */
  heading: number;
  /** The line after the column: the next `#`/`##` heading, or the file's end. */
  end: number;
  cards: Card[];
}

export interface Board {
  eol: '\n' | '\r\n';
  title: string | null;
  columns: Column[];
}

export interface CardRef {
  column: number;
  card: number;
}

const HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?[ \t]*$/;
const FENCE = /^ {0,3}(`{3,}|~{3,})/;
export const TASK_ITEM = /^( *)([-*+]|\d{1,9}[.)])([ \t]+)\[([ xX])\](?:[ \t]+|$)(.*)$/;

/** The file's lines, without the empty one after a final newline. */
export function splitLines(text: string): { lines: string[]; eol: '\n' | '\r\n'; finalNewline: boolean } {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/);
  const finalNewline = lines.length > 1 && lines[lines.length - 1] === '';
  if (finalNewline || text === '') lines.pop();
  return { lines, eol, finalNewline };
}

export function joinLines(lines: string[], eol: string, finalNewline: boolean): string {
  return lines.join(eol) + (finalNewline && lines.length > 0 ? eol : '');
}

/** A heading's level and text (closing hashes dropped), or null. */
function heading(line: string): { level: number; text: string } | null {
  const match = HEADING.exec(line);
  if (!match) return null;
  const text = (match[2] ?? '').replace(/(?:^|[ \t]+)#+$/, '').trim();
  return { level: match[1].length, text };
}

/** Width of a line's leading whitespace, a tab to the next multiple of 4. */
function indentOf(line: string): number {
  let width = 0;
  for (const char of line) {
    if (char === ' ') width++;
    else if (char === '\t') width += 4 - (width % 4);
    else break;
  }
  return width;
}

/** A line with `width` columns of its indentation taken off. */
function unindent(line: string, width: number): string {
  let taken = 0;
  let i = 0;
  while (i < line.length && taken < width) {
    if (line[i] === ' ') taken++;
    else if (line[i] === '\t') taken += 4 - (taken % 4);
    else break;
    i++;
  }
  return line.slice(i);
}

const isBlank = (line: string) => line.trim() === '';

/** Which lines are in code fences (or front matter), where nothing is a heading or card. */
function literalLines(text: string, lines: string[]): boolean[] {
  const literal = new Array<boolean>(lines.length).fill(false);
  const frontMatter = splitFrontMatter(text);
  let i = 0;
  if (frontMatter) {
    const count = text.slice(0, frontMatter.length).split('\n').length - 1;
    for (; i < count && i < lines.length; i++) literal[i] = true;
  }
  let fence: string | null = null;
  for (; i < lines.length; i++) {
    const match = FENCE.exec(lines[i]);
    if (fence) {
      literal[i] = true;
      if (match && match[1][0] === fence[0] && match[1].length >= fence.length && isBlank(lines[i].slice(match[0].length))) fence = null;
    } else if (match) {
      literal[i] = true;
      fence = match[1];
    }
  }
  return literal;
}

/** The card starting at `start`, whose block runs while lines are indented under it. */
function readCard(lines: string[], literal: boolean[], start: number, limit: number, match: RegExpExecArray): Card {
  const [, spaces, marker, gap, box, title] = match;
  const indent = spaces.length;
  // A gap of 5 or more spaces is indented code inside the item: content
  // starts one space after the marker.
  const contentIndent = indent + marker.length + (gap.length > 4 ? 1 : gap.length);

  let end = start + 1;
  for (let i = start + 1; i < limit; i++) {
    if (isBlank(lines[i])) continue;
    if (indentOf(lines[i]) < contentIndent) break;
    end = i + 1;
  }

  const subtasks: Subtask[] = [];
  const body: string[] = [];
  const notes: string[] = [];
  for (let i = start + 1; i < end; i++) {
    const line = isBlank(lines[i]) ? '' : unindent(lines[i], contentIndent);
    body.push(line);
    const sub = literal[i] ? null : TASK_ITEM.exec(lines[i]);
    if (sub) subtasks.push({ line: i, checked: sub[4] !== ' ', text: sub[5] });
    else notes.push(line);
  }

  return {
    checked: box !== ' ',
    start,
    end,
    title,
    body: body.join('\n'),
    notes: notes.join('\n').trim(),
    subtasks,
    marker,
    indent,
    contentIndent,
  };
}

export function parseBoard(text: string): Board {
  const { lines, eol } = splitLines(text);
  const literal = literalLines(text, lines);

  let title: string | null = null;
  const columns: Column[] = [];
  let open: Column | null = null;

  for (let i = 0; i < lines.length; i++) {
    if (literal[i]) continue;
    const found = heading(lines[i]);
    if (found && found.level <= 2) {
      if (open) open.end = i;
      open = null;
      if (found.level === 2) {
        const { name, color } = splitColor(found.text);
        open = { name, color, heading: i, end: lines.length, cards: [] };
        columns.push(open);
      } else if (columns.length === 0 && title === null) {
        title = found.text;
      }
      continue;
    }
    if (!open) continue;
    const item = TASK_ITEM.exec(lines[i]);
    if (item && item[1].length <= 3) {
      const card = readCard(lines, literal, i, findEnd(lines, literal, i), item);
      open.cards.push(card);
      i = card.end - 1;
    }
  }

  return { eol, title, columns };
}

/** The line a card can run to at most: the next `#`/`##` heading. */
function findEnd(lines: string[], literal: boolean[], from: number): number {
  for (let i = from + 1; i < lines.length; i++) {
    if (literal[i]) continue;
    const found = heading(lines[i]);
    if (found && found.level <= 2 && indentOf(lines[i]) <= 3) return i;
  }
  return lines.length;
}

/**
 * A column's colour rides on its heading as an Obsidian comment, which notes
 * hide: `## To Do %%color: red%%`. A canvas preset's name or number, or hex.
 */
const COLOR_COMMENT = /\s*%%\s*colou?r:\s*([^%]*?)\s*%%$/i;
const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
export const COLUMN_COLORS = ['red', 'orange', 'yellow', 'green', 'cyan', 'purple'] as const;

/** A heading's text as its name and colour (null for none, or one not understood). */
export function splitColor(text: string): { name: string; color: string | null } {
  const match = COLOR_COMMENT.exec(text);
  if (!match) return { name: text, color: null };
  const value = match[1].toLowerCase();
  const preset = COLUMN_COLORS.indexOf(value as (typeof COLUMN_COLORS)[number]);
  const color = preset !== -1 ? String(preset + 1) : /^[1-6]$/.test(value) || HEX.test(value) ? value : null;
  return { name: text.slice(0, match.index).trimEnd(), color };
}

/** The comment that gives a heading `color` (a preset number or hex), or nothing. */
export function colorComment(color: string | null): string {
  if (!color) return '';
  const preset = /^[1-6]$/.test(color) ? COLUMN_COLORS[Number(color) - 1] : color;
  return ` %%color: ${preset}%%`;
}

/** What editing a card shows: its title, then its nested lines. */
export function cardMarkdown(card: Card): string {
  return card.body ? `${card.title}\n${card.body}` : card.title;
}

export function cardAt(board: Board, ref: CardRef): Card | null {
  return board.columns[ref.column]?.cards[ref.card] ?? null;
}

/** A card title as plain text, for where it isn't rendered (a board embed): links by their label, no emphasis marks. */
export function plainTitle(title: string): string {
  return title
    .replace(/\[\[([^\]|]*?)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]/g, (_, target: string, alias?: string) => alias ?? wikilinkLabel(target))
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__|~~|==)(.+?)\1/g, '$2')
    .replace(/(^|[^\w*])[*_](\S(?:.*?\S)?)[*_](?=[^\w*]|$)/g, '$1$2')
    .replace(/`([^`]+)`/g, '$1');
}
