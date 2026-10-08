/**
 * `==highlight==`, Obsidian's, as an mdast `highlight` node holding phrasing
 * content, so `==**bold** words==` keeps its bold.
 *
 * Paired over the parsed tree rather than tokenized: micromark would need an
 * attention construct (the way GFM pairs `~~`) for nesting to work, and pairing
 * the `==` left in text nodes gets the same result for this one marker. The
 * rule is strikethrough's: `==` opens before a non-space and closes after one,
 * runs of three or more are left alone, and an unclosed one stays text.
 */

export const HIGHLIGHT_MDAST_TYPE = 'highlight';

interface MdastNode {
  type: string;
  value?: string;
  children?: MdastNode[];
}

/** Containers whose text is never markdown. */
const LITERAL = new Set(['inlineCode', 'code', 'html', 'wikiLink', 'wikiEmbed', 'solsticeInlineMath', 'solsticeMathBlock', 'solsticeFrontmatter']);

type Delimiter = { delimiter: true; open: boolean; close: boolean };
type Part = MdastNode | Delimiter;

const isDelimiter = (part: Part): part is Delimiter => 'delimiter' in part;
const isSpace = (char: string | undefined) => char === undefined || /\s/.test(char);

/** A text node's `==` runs, as delimiters; neighbours that aren't text count as non-space. */
function split(node: MdastNode, before: MdastNode | undefined, after: MdastNode | undefined): Part[] {
  const value = node.value ?? '';
  const parts: Part[] = [];
  let last = 0;
  for (const match of value.matchAll(/(?<!=)==(?!=)/g)) {
    const at = match.index;
    const prev = at > 0 ? value[at - 1] : before ? (before.type === 'text' ? before.value?.slice(-1) : 'x') : undefined;
    const next = at + 2 < value.length ? value[at + 2] : after ? (after.type === 'text' ? after.value?.[0] : 'x') : undefined;
    if (at > last) parts.push({ type: 'text', value: value.slice(last, at) });
    parts.push({ delimiter: true, open: !isSpace(next), close: !isSpace(prev) });
    last = at + 2;
  }
  if (parts.length === 0) return [node];
  if (last < value.length) parts.push({ type: 'text', value: value.slice(last) });
  return parts;
}

/** Text again: adjacent text nodes joined, leftover delimiters back to `==`. */
function settle(parts: Part[]): MdastNode[] {
  const out: MdastNode[] = [];
  for (const part of parts) {
    const node = isDelimiter(part) ? { type: 'text', value: '==' } : part;
    const prev = out[out.length - 1];
    if (node.type === 'text' && prev?.type === 'text') prev.value = (prev.value ?? '') + (node.value ?? '');
    else out.push(node);
  }
  return out;
}

function pair(children: MdastNode[]): MdastNode[] {
  if (!children.some((c) => c.type === 'text' && c.value?.includes('=='))) return children;
  const parts = children.flatMap((child, i) =>
    child.type === 'text' ? split(child, children[i - 1], children[i + 1]) : [child],
  );

  const out: Part[] = [];
  let opener = -1;
  for (const part of parts) {
    if (!isDelimiter(part)) {
      out.push(part);
      continue;
    }
    if (opener >= 0 && part.close && out.length > opener + 1) {
      const inner = settle(out.splice(opener + 1));
      out.pop();
      out.push({ type: HIGHLIGHT_MDAST_TYPE, children: inner });
      opener = -1;
    } else if (part.open) {
      // An earlier opener that never closed is text.
      if (opener >= 0) out[opener] = { type: 'text', value: '==' };
      opener = out.length;
      out.push(part);
    } else {
      out.push({ type: 'text', value: '==' });
    }
  }
  return settle(out);
}

function walk(node: MdastNode) {
  if (!node.children || LITERAL.has(node.type)) return;
  for (const child of node.children) walk(child);
  node.children = pair(node.children);
}

interface Tracker {
  move(value: string): string;
  current(): object;
}

interface State {
  enter(name: string): () => void;
  createTracker(info: object): Tracker;
  containerPhrasing(node: MdastNode, info: object): string;
}

function handleHighlight(node: MdastNode, _parent: unknown, state: State, info: object) {
  const tracker = state.createTracker(info);
  const exit = state.enter('highlight');
  let value = tracker.move('==');
  value += tracker.move(state.containerPhrasing(node, { ...tracker.current(), before: value, after: '=' }));
  value += tracker.move('==');
  exit();
  return value;
}
handleHighlight.peek = () => '=';

const toMarkdownExtension = { handlers: { [HIGHLIGHT_MDAST_TYPE]: handleHighlight } };

export function remarkHighlight(this: { data(): unknown }) {
  const data = this.data() as { toMarkdownExtensions?: unknown[] };
  (data.toMarkdownExtensions ??= []).push(toMarkdownExtension);
  return (tree: MdastNode) => walk(tree);
}
