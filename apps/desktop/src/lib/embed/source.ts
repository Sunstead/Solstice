import { commands, events } from '@/lib/backend';

/**
 * Markdown of transcluded notes, shared by every embed pointing at the same
 * file so a note embedded ten times is read once.
 */
const sources = new Map<string, string>();
const inFlight = new Map<string, Promise<string | null>>();
const subscribers = new Set<() => void>();

let watching = false;

function notify() {
  for (const subscriber of subscribers) subscriber();
}

/**
 * External edits arrive as filesystem events. Subscribed lazily, and only
 * once, so a workspace with no embeds in it pays nothing.
 */
function ensureWatching() {
  if (watching) return;
  watching = true;

  void events.fileSystemChanged.listen((event) => {
    let touched = false;

    for (const change of event.payload.changes) {
      if (sources.delete(change.path)) touched = true;
      if (change.from && sources.delete(change.from)) touched = true;
    }

    if (touched) notify();
  });
}

export function subscribeToEmbedSources(onChange: () => void): () => void {
  subscribers.add(onChange);
  return () => subscribers.delete(onChange);
}

/**
 * Publishes the text the app itself just wrote.
 *
 * The watcher deliberately suppresses the app's own writes, so without this an
 * embed would go stale exactly when its source is being edited in another tab.
 * Only paths something is actually transcluding are kept, so this cannot grow
 * without bound.
 */
export function noteEmbedSourceWritten(path: string, markdown: string) {
  if (!sources.has(path)) return;

  sources.set(path, markdown);
  notify();
}

export async function loadEmbedSource(path: string): Promise<string | null> {
  ensureWatching();

  const cached = sources.get(path);
  if (cached !== undefined) return cached;

  const pending = inFlight.get(path);
  if (pending) return pending;

  const read = commands
    .readFile(path)
    .then((result) => {
      if (result.status === 'error') return null;
      sources.set(path, result.data);
      return result.data;
    })
    .finally(() => inFlight.delete(path));

  inFlight.set(path, read);
  return read;
}

const HEADING = /^(#{1,6})\s+(.*)$/;
const FENCE = /^\s*(```|~~~)/;

/**
 * The section introduced by `heading`, up to the next heading of the same or
 * higher level. Fenced code is tracked so a `#` comment inside a shell snippet
 * cannot be mistaken for a heading.
 */
export function sliceSection(markdown: string, heading: string): string | null {
  const lines = markdown.split('\n');
  const wanted = heading.trim().toLowerCase();

  let start = -1;
  let level = 0;
  let fenced = false;

  for (let index = 0; index < lines.length; index += 1) {
    if (FENCE.test(lines[index])) fenced = !fenced;
    if (fenced) continue;

    const match = HEADING.exec(lines[index]);
    if (!match) continue;

    if (start === -1) {
      if (match[2].trim().toLowerCase() === wanted) {
        start = index;
        level = match[1].length;
      }
      continue;
    }

    if (match[1].length <= level) return lines.slice(start, index).join('\n');
  }

  return start === -1 ? null : lines.slice(start).join('\n');
}

const LIST_ITEM = /^\s*(?:[-*+]|\d+[.)])\s/;

/**
 * The block a `^id` marks, for `![[note#^id]]`, without the marker: the
 * paragraph or list item it ends, or, when it stands on a line of its own, the
 * block just before it (a list, a table, a quote).
 */
export function sliceBlock(markdown: string, id: string): string | null {
  const lines = markdown.split('\n');
  const marker = new RegExp(`(?:^|\\s)\\^${id.replace(/[^A-Za-z0-9-]/g, '')}\\s*$`);
  const blank = (line: string) => line.trim() === '';
  let fenced = false;

  for (let index = 0; index < lines.length; index += 1) {
    if (FENCE.test(lines[index])) fenced = !fenced;
    if (fenced || !marker.test(lines[index])) continue;

    const strip = (line: string) => line.replace(marker, '');
    const alone = strip(lines[index]).trim() === '';

    let end = alone ? index - 1 : index;
    while (alone && end >= 0 && blank(lines[end])) end -= 1;
    if (end < 0) return null;
    if (!alone && LIST_ITEM.test(lines[index])) return strip(lines[index]).trimEnd();

    let start = end;
    while (start > 0 && !blank(lines[start - 1])) start -= 1;
    if (!alone) while (end + 1 < lines.length && !blank(lines[end + 1])) end += 1;
    return lines
      .slice(start, end + 1)
      .map((line, i) => (start + i === index ? strip(line).trimEnd() : line))
      .join('\n');
  }
  return null;
}
