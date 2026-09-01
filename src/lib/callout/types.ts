/**
 * `> [!warning]- Title`
 *
 * The marker sits at the very start of the blockquote's first paragraph. The
 * optional `-`/`+` makes the callout foldable, collapsed and expanded
 * respectively -- exactly Obsidian's grammar, so vaults move between the two
 * without editing.
 */
const CALLOUT_MARKER = /^\[!([A-Za-z][\w-]*)\]([-+])?([ \t]?)/;

export interface CalloutMarker {
  /** Canonical type, after alias resolution. */
  type: string;
  /** Length of the marker text including its trailing space, for hiding. */
  length: number;
  /** Just `[!type]` and any fold hint -- the range the mark covers. */
  markerLength: number;
  foldable: boolean;
  /** Whether the marker asks for it to start collapsed. */
  collapsed: boolean;
}

/**
 * Every alias Obsidian accepts, folded onto the set that has an icon and a
 * colour here. Unknown types are kept as-is and fall back to the note styling,
 * so a vault using a custom type still renders as a callout.
 */
const ALIASES: Record<string, string> = {
  summary: 'abstract',
  tldr: 'abstract',
  hint: 'tip',
  important: 'tip',
  check: 'success',
  done: 'success',
  help: 'question',
  faq: 'question',
  caution: 'warning',
  attention: 'warning',
  fail: 'failure',
  missing: 'failure',
  error: 'danger',
  cite: 'quote',
};

export function parseCallout(text: string): CalloutMarker | null {
  const match = CALLOUT_MARKER.exec(text);
  if (!match) return null;

  const raw = match[1].toLowerCase();

  return {
    type: ALIASES[raw] ?? raw,
    length: match[0].length,
    markerLength: match[0].length - match[3].length,
    foldable: match[2] !== undefined,
    collapsed: match[2] === '-',
  };
}
