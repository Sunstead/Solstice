import { useEffect, useMemo, useRef, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';

import type { FlatText } from '@/lib/find/matches';
import { useFindStore } from '@/lib/stores/find';
import { flattenPage, matchPage, type PageMatches, type TextPosition } from './search';

/**
 * How often a partially-built index is published while it fills.
 *
 * Every publish re-runs the search over every page indexed so far, so this is
 * the knob trading how quickly the count climbs against how much duplicated
 * scanning a long document does on the way there.
 */
const PROGRESS_INTERVAL_MS = 200;

export type PdfFindState = {
  /** By page index, `matchesByPage[0]` being page 1. */
  matchesByPage: PageMatches[];
  /** Document-wide index of the current match, or -1. */
  activeMatch: number;
  /** 1-based page the current match is on, or `null`. */
  activePage: number | null;
};

const EMPTY: PdfFindState = { matchesByPage: [], activeMatch: -1, activePage: null };

/**
 * Find-in-PDF, wired to the same store the editor's find bar uses.
 *
 * The document's text is extracted lazily and only once find is actually
 * opened: `getTextContent()` on every page of a textbook is seconds of work,
 * and nobody who opened a PDF to look at it should pay for a search they never
 * ran. It is published progressively so the counter climbs while it runs
 * rather than sitting at zero and then jumping.
 */
export function usePdfFind(
  pdf: PDFDocumentProxy | null,
  path: string,
): PdfFindState {
  const open = useFindStore((s) => s.openPath === path);
  const query = useFindStore((s) => s.query);
  const caseSensitive = useFindStore((s) => s.caseSensitive);
  const wholeWord = useFindStore((s) => s.wholeWord);
  const stepRequest = useFindStore((s) => s.stepRequest);

  /** Flattened page text, filled in page order; `undefined` == not yet read. */
  const flats = useRef<(FlatText<TextPosition> | undefined)[]>([]);
  const [indexed, setIndexed] = useState(0);
  const [activeMatch, setActiveMatch] = useState(-1);

  const searching = open && query.length > 0;

  // A new document invalidates everything keyed to the old one.
  useEffect(() => {
    flats.current = [];
    setIndexed(0);
    setActiveMatch(-1);
  }, [pdf]);

  useEffect(() => {
    if (!pdf || !searching) return;
    if (flats.current.length >= pdf.numPages) return;

    let cancelled = false;
    let lastPublish = 0;

    const build = async () => {
      for (let page = flats.current.length + 1; page <= pdf.numPages; page += 1) {
        const flat = await flattenPage(pdf, page).catch(() => undefined);
        if (cancelled) return;

        // Assigned by index rather than pushed: a page that failed to read
        // still has to hold its slot or every later page shifts.
        flats.current[page - 1] = flat ?? { text: '', positions: [] };

        const now = performance.now();
        if (page === pdf.numPages || now - lastPublish > PROGRESS_INTERVAL_MS) {
          lastPublish = now;
          setIndexed(page);
        }
      }
    };

    void build();

    return () => {
      cancelled = true;
    };
  }, [pdf, searching]);

  const { matchesByPage, total } = useMemo(() => {
    if (!searching) return { matchesByPage: [] as PageMatches[], total: 0 };

    const pages: PageMatches[] = [];
    let running = 0;

    for (let index = 0; index < indexed; index += 1) {
      const flat = flats.current[index];
      if (!flat) continue;

      const page = matchPage(flat, query, { caseSensitive, wholeWord }, running);
      running += page.count;
      pages[index] = page;
    }

    return { matchesByPage: pages, total: running };
    // `indexed` stands in for the mutable ref: it only ever grows, and every
    // growth is exactly what makes the ref's contents change.
  }, [searching, indexed, query, caseSensitive, wholeWord]);

  // Clamped rather than reset, matching the editor: narrowing a query should
  // leave the user near where they were, not back at the top of the file.
  useEffect(() => {
    setActiveMatch((current) => {
      if (total === 0) return -1;
      return Math.min(Math.max(current, 0), total - 1);
    });
  }, [total]);

  const lastStep = useRef(0);
  useEffect(() => {
    if (!stepRequest || stepRequest.nonce === lastStep.current) return;
    lastStep.current = stepRequest.nonce;
    if (total === 0) return;

    setActiveMatch((current) => (current + stepRequest.direction + total) % total);
  }, [stepRequest, total]);

  useEffect(() => {
    if (open) useFindStore.getState().reportMatches(total, activeMatch);
  }, [open, total, activeMatch]);

  const activePage = useMemo(() => {
    if (activeMatch < 0) return null;

    let running = 0;
    for (let index = 0; index < matchesByPage.length; index += 1) {
      const count = matchesByPage[index]?.count ?? 0;
      if (activeMatch < running + count) return index + 1;
      running += count;
    }

    return null;
  }, [matchesByPage, activeMatch]);

  if (!searching) return EMPTY;

  return { matchesByPage, activeMatch, activePage };
}
