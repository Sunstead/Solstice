import type { PDFDocumentProxy } from 'pdfjs-dist';

import { searchFlat, type FindOptions, type FlatText } from '@/lib/find/matches';

/** Where a character sits in the page's text layer. */
export type TextPosition = { itemIndex: number; offset: number };

/** A run of matched characters inside one text-layer item. */
export type ItemHighlight = { start: number; end: number; matchIndex: number };

export type PageMatches = {
  /** Total matches on this page. */
  count: number;
  /** By text-layer item index, so a renderer can look up only its own item. */
  byItem: Map<number, ItemHighlight[]>;
};

/**
 * Flattens one page into searchable text.
 *
 * The index deliberately matches `getTextContent().items` rather than the DOM:
 * react-pdf hands `customTextRenderer` that same array index, which is the
 * only stable handle between a match and the span it has to be painted on.
 *
 * A newline is inserted wherever pdf.js reports an end-of-line, mirroring the
 * block separator the editor's flattener uses -- so a query cannot match
 * across a line break in one engine and not the other.
 */
export async function flattenPage(
  pdf: PDFDocumentProxy,
  pageNumber: number,
): Promise<FlatText<TextPosition>> {
  const page = await pdf.getPage(pageNumber);
  const content = await page.getTextContent();

  let text = '';
  const positions: TextPosition[] = [];

  content.items.forEach((item, itemIndex) => {
    if (!('str' in item)) return;

    for (let offset = 0; offset < item.str.length; offset += 1) {
      text += item.str[offset];
      positions.push({ itemIndex, offset });
    }

    if (item.hasEOL) {
      text += '\n';
      positions.push({ itemIndex, offset: item.str.length });
    }
  });

  return { text, positions };
}

/**
 * Runs a query over one flattened page.
 *
 * `firstMatchIndex` is where this page's matches start in the document-wide
 * numbering, so the find bar's "3 of 47" counts across the whole PDF rather
 * than restarting on every page.
 *
 * A match spanning two text items is clipped to the item it starts in: the
 * items are separate absolutely-positioned spans, so there is no single box to
 * draw across, and highlighting the first part is honest about where it is.
 */
export function matchPage(
  flat: FlatText<TextPosition>,
  query: string,
  options: FindOptions,
  firstMatchIndex: number,
): PageMatches {
  const found = searchFlat(flat, query, options);
  const byItem = new Map<number, ItemHighlight[]>();

  found.forEach(({ start, end }, index) => {
    const from = flat.positions[start];
    let last = end - 1;
    while (last > start && flat.positions[last].itemIndex !== from.itemIndex) {
      last -= 1;
    }

    const highlights = byItem.get(from.itemIndex) ?? [];
    highlights.push({
      start: from.offset,
      end: flat.positions[last].offset + 1,
      matchIndex: firstMatchIndex + index,
    });
    byItem.set(from.itemIndex, highlights);
  });

  return { count: found.length, byItem };
}

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
};

/**
 * `customTextRenderer` returns an HTML string, so every character of the PDF's
 * own text has to be escaped before it goes back in -- a document containing
 * `<script>` as literal text must not become one.
 */
function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/g, (character) => ESCAPES[character]);
}

/**
 * Wraps the matched runs of one text-layer item in `<mark>`.
 *
 * The marks carry no colour of their own: `viewer.css` paints them from the
 * same `--primary` mix `find.css` uses, so a match in a PDF and a match in a
 * note look identical.
 */
export function renderItemHighlights(
  str: string,
  highlights: ItemHighlight[] | undefined,
  activeMatch: number,
): string {
  if (!highlights || highlights.length === 0) return escapeHtml(str);

  const ordered = [...highlights].sort((a, b) => a.start - b.start);

  let html = '';
  let cursor = 0;

  for (const { start, end, matchIndex } of ordered) {
    if (start < cursor) continue;

    html += escapeHtml(str.slice(cursor, start));
    const active = matchIndex === activeMatch ? ' find-match-active' : '';
    html += `<mark class="find-match${active}">${escapeHtml(str.slice(start, end))}</mark>`;
    cursor = end;
  }

  return html + escapeHtml(str.slice(cursor));
}
