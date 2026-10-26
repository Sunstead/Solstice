import type { DateParts } from '@/lib/backend/native';

/** A date value in a front matter line: where it sits, and how it's written. */
export type FoundDate = {
  /** The line up to the value (`due: `, and an opening quote). */
  before: string;
  /** The value itself (`2026-10-25`, `2026-10-25T09:30`). */
  value: string;
  /** The rest (a closing quote, a comment). */
  after: string;
  parts: DateParts;
  /** How the time is written, kept when it's changed: `T` or a space, and seconds. */
  separator: 'T' | ' ';
  seconds: boolean;
};

// `key: 2026-10-25`, optionally with a time, quoted or not, a comment after.
const DATE_LINE =
  /^(\s*[^\s#:][^:]*:\s+["']?)(\d{4})-(\d{2})-(\d{2})(?:([T ])(\d{2}):(\d{2})(:\d{2})?)?(["']?\s*(?:#.*)?)$/;

/** The date a line of front matter holds as its value, if it holds one. */
export function findDate(line: string): FoundDate | null {
  const m = DATE_LINE.exec(line);
  if (!m) return null;
  const [, before, year, month, day, separator, hour, minute, seconds, after] = m;
  const quote = /["']$/.exec(before)?.[0];
  // A quote opened must be the one closed.
  if ((quote ?? '') !== (/^["']/.exec(after)?.[0] ?? '')) return null;
  const parts: DateParts = { year: +year, month: +month, day: +day };
  if (hour !== undefined) {
    parts.hour = +hour;
    parts.minute = +minute;
  }
  if (parts.month < 1 || parts.month > 12 || parts.day < 1 || parts.day > 31) return null;
  const value = line.slice(before.length, line.length - after.length);
  return { before, value, after, parts, separator: separator === ' ' ? ' ' : 'T', seconds: !!seconds };
}

const pad = (n: number, width = 2) => String(n).padStart(width, '0');

/** `parts` written the way `like` was. */
export function formatDate(parts: DateParts, like: Pick<FoundDate, 'separator' | 'seconds'>): string {
  const date = `${pad(parts.year, 4)}-${pad(parts.month)}-${pad(parts.day)}`;
  if (parts.hour === undefined) return date;
  return `${date}${like.separator}${pad(parts.hour)}:${pad(parts.minute ?? 0)}${like.seconds ? ':00' : ''}`;
}

/** The front matter block with line `index` (of the block, fences included) holding `parts`. */
export function withDate(block: string, index: number, parts: DateParts): string {
  const lines = block.split('\n');
  const found = findDate(lines[index] ?? '');
  if (!found) return block;
  lines[index] = found.before + formatDate(parts, found) + found.after;
  return lines.join('\n');
}
