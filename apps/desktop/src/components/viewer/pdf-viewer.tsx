import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Document } from 'react-pdf';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { ChevronLeft, ChevronRight, FileWarning, Minus, Plus } from 'lucide-react';

import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { registerScopedCommand, unregisterScopedCommand } from '@/lib/commands';
import type { ScopedCommandId } from '@/lib/commands';
import { useActiveEditorStore } from '@/lib/stores/active-editor';
import { useFindStore } from '@/lib/stores/find';
import { usePdfFind } from '@/lib/pdf/use-pdf-find';
import { useAssetUrl } from '@/lib/viewer/asset';
import { basename } from '@/lib/wikilink/target';
import '@/lib/pdf/worker';
import { PdfPage } from './pdf-page';
import { ViewerFrame } from './viewer-frame';
import {
  ViewerToolbar,
  ViewerToolbarReadout,
  ViewerToolbarSeparator,
} from './viewer-toolbar';

/** US Letter at 72dpi -- only ever shown for the frame or two before page 1 loads. */
const FALLBACK_SIZE = { width: 612, height: 792 };

const PAGE_GAP = 16;
const PAGE_MARGIN = 32;
const MIN_SCALE = 0.2;
const MAX_SCALE = 6;
const ZOOM_STEP = 0.2;

/**
 * How far outside the viewport a page still renders. Two viewports of slack in
 * each direction covers a fast flick without holding more than a handful of
 * canvases.
 */
const RENDER_MARGIN = '200% 0px';

/**
 * Pages either side of the current one that render regardless of the observer.
 *
 * A backstop, not the mechanism: if intersection reporting is ever wrong or
 * late, the reader still sees the page they are on rather than a placeholder.
 */
const NEARBY_PAGES = 2;

/**
 * Only the page crossing the vertical middle of the viewport intersects, which
 * is a truer answer to "which page am I on" than the topmost visible one.
 */
const CURRENT_PAGE_MARGIN = '-45% 0px -45% 0px';

type ZoomMode = 'fit-width' | 'fit-page' | 'custom';

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

/**
 * A PDF opened as its own tab.
 *
 * Replaces an `<iframe>`, which handed the file to whichever reader the
 * platform's webview happens to embed -- three different toolbars across
 * macOS, Windows and Linux, and on WebKitGTK no reader at all. Rendering with
 * pdf.js means one set of controls everywhere, and a text layer the app's own
 * find bar can search.
 */
export function PdfViewer({ path }: { path: string }) {
  const asset = useAssetUrl(path);
  const scopeId = useId();

  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [intrinsic, setIntrinsic] = useState<Map<number, { width: number; height: number }>>(
    () => new Map(),
  );
  const [mountedPages, setMountedPages] = useState<Set<number>>(() => new Set([1]));
  const [currentPage, setCurrentPage] = useState(1);
  const [pageDraft, setPageDraft] = useState<string | null>(null);
  const [zoom, setZoom] = useState<{ mode: ZoomMode; scale: number }>({
    mode: 'fit-page',
    scale: 1,
  });
  const [viewport, setViewport] = useState({ width: 0, height: 0 });

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const pageNodes = useRef(new Map<number, HTMLDivElement>());

  const numPages = pdf?.numPages ?? 0;
  const { matchesByPage, activeMatch, activePage } = usePdfFind(pdf, path);

  // react-pdf reloads the document whenever this changes identity, so it has
  // to survive every unrelated re-render of this component.
  // Keyed on the URL string, not the asset object: react-pdf reloads the whole
  // document whenever this changes identity, so it must not churn just because
  // the hook re-created an otherwise identical result.
  const url = asset.status === 'ready' ? asset.url : null;
  const file = useMemo(() => (url ? { url } : null), [url]);

  const baseSize = intrinsic.get(1) ?? FALLBACK_SIZE;

  const scale = useMemo(() => {
    if (zoom.mode === 'custom' || viewport.width === 0) return zoom.scale;

    const width = (viewport.width - PAGE_MARGIN * 2) / baseSize.width;
    if (zoom.mode === 'fit-width') return clamp(width, MIN_SCALE, MAX_SCALE);

    const height = (viewport.height - PAGE_MARGIN * 2) / baseSize.height;
    return clamp(Math.min(width, height), MIN_SCALE, MAX_SCALE);
  }, [zoom, viewport, baseSize]);

  const setScale = (next: number) =>
    setZoom({ mode: 'custom', scale: clamp(next, MIN_SCALE, MAX_SCALE) });

  // -- scoped commands ------------------------------------------------

  /*
   * Only the commands this viewer can honour are registered. An id left
   * unregistered still resolves to this scope and finds no handler, which is
   * exactly right: `Cmd+B` over a PDF should do nothing, not reach back into
   * whichever editor happened to be focused last.
   */
  useEffect(() => {
    const handlers: Partial<Record<ScopedCommandId, () => void>> = {
      'edit.find': () => useFindStore.getState().openFor(path),
      'native.select_all': () => {
        const layer = scrollRef.current;
        if (!layer) return;
        const range = document.createRange();
        range.selectNodeContents(layer);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
      },
      'native.copy': () => void document.execCommand('copy'),
    };

    for (const [id, handler] of Object.entries(handlers)) {
      registerScopedCommand(scopeId, id as ScopedCommandId, handler);
    }

    // Opening a file from the explorer selects the tab but leaves focus in the
    // tree, so nothing would claim the scope and `Cmd+F` would fall through to
    // whichever editor was focused last. Claimed only when the seat is empty,
    // so a background tab mounting never steals it from a focused editor.
    if (useActiveEditorStore.getState().activeEditorId === null) {
      useActiveEditorStore.getState().setActiveEditor(scopeId);
    }

    return () => {
      for (const id of Object.keys(handlers)) {
        unregisterScopedCommand(scopeId, id as ScopedCommandId);
      }

      // Cleared on unmount only. Clearing on blur would leave a menu click --
      // which blurs the viewer to open the menu -- with no target at all.
      if (useActiveEditorStore.getState().activeEditorId === scopeId) {
        useActiveEditorStore.getState().setActiveEditor(null);
      }
    };
  }, [scopeId, path]);

  // -- measurement and windowing --------------------------------------

  /*
   * Observers are held here and bound to each page as it registers, rather
   * than gathered up once in an effect.
   *
   * That effect used to snapshot the page nodes and key itself on `numPages`.
   * Renaming a file changes the path, which reloads `<Document>`, which swaps
   * in its loading state and remounts every page as a *new* DOM node -- but
   * the page count is identical, so the effect never re-ran and the observers
   * were left watching detached nodes. Nothing intersected again, so no page
   * ever re-entered the render window and the whole document sat there as
   * numbered placeholders.
   */
  const viewportObserver = useRef<ResizeObserver | null>(null);
  const windowObserver = useRef<IntersectionObserver | null>(null);
  const currentPageObserver = useRef<IntersectionObserver | null>(null);

  const observePage = useCallback((node: HTMLDivElement) => {
    windowObserver.current?.observe(node);
    currentPageObserver.current?.observe(node);
  }, []);

  /**
   * Attaches the scrolling element and everything that watches it.
   *
   * A callback ref rather than an effect, so the observers are rebuilt exactly
   * when the element they need as their root appears or is replaced -- there is
   * no dependency list here that can go stale.
   */
  const attachScroller = useCallback(
    (root: HTMLDivElement | null) => {
      viewportObserver.current?.disconnect();
      windowObserver.current?.disconnect();
      currentPageObserver.current?.disconnect();
      viewportObserver.current = null;
      windowObserver.current = null;
      currentPageObserver.current = null;

      scrollRef.current = root;
      if (!root) return;

      viewportObserver.current = new ResizeObserver(([entry]) => {
        setViewport({
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        });
      });
      viewportObserver.current.observe(root);

      windowObserver.current = new IntersectionObserver(
        (entries) => {
          setMountedPages((previous) => {
            const next = new Set(previous);
            let changed = false;

            for (const entry of entries) {
              const page = Number((entry.target as HTMLElement).dataset.page);
              if (entry.isIntersecting === next.has(page)) continue;
              if (entry.isIntersecting) next.add(page);
              else next.delete(page);
              changed = true;
            }

            return changed ? next : previous;
          });
        },
        { root, rootMargin: RENDER_MARGIN },
      );

      currentPageObserver.current = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            setCurrentPage(Number((entry.target as HTMLElement).dataset.page));
          }
        },
        { root, rootMargin: CURRENT_PAGE_MARGIN },
      );

      // Pages that registered before the scroller did, on the first mount.
      for (const node of pageNodes.current.values()) observePage(node);
    },
    [observePage],
  );

  const registerNode = useCallback(
    (pageNumber: number, node: HTMLDivElement | null) => {
      const previous = pageNodes.current.get(pageNumber);
      if (previous && previous !== node) {
        windowObserver.current?.unobserve(previous);
        currentPageObserver.current?.unobserve(previous);
      }

      if (node) {
        pageNodes.current.set(pageNumber, node);
        observePage(node);
      } else {
        pageNodes.current.delete(pageNumber);
      }
    },
    [observePage],
  );

  const onIntrinsicSize = useCallback(
    (pageNumber: number, size: { width: number; height: number }) => {
      setIntrinsic((previous) => {
        const known = previous.get(pageNumber);
        if (known && known.width === size.width && known.height === size.height) {
          return previous;
        }
        const next = new Map(previous);
        next.set(pageNumber, size);
        return next;
      });
    },
    [],
  );

  /*
   * A different file -- or the same file under a new name -- is a different
   * document. Page sizes, which pages are mounted and where we were all belong
   * to the old one, and carrying them over is what leaves stale pages on screen
   * while the new document loads.
   */
  useEffect(() => {
    setPdf(null);
    setError(null);
    setIntrinsic(new Map());
    setMountedPages(new Set([1]));
    setCurrentPage(1);
  }, [file]);

  const goToPage = useCallback((pageNumber: number) => {
    pageNodes.current.get(pageNumber)?.scrollIntoView({ block: 'start' });
  }, []);

  // Follows the find bar to whichever page the current match is on. The match
  // itself is scrolled into view separately, once that page has actually
  // rendered its text layer.
  useEffect(() => {
    if (activePage !== null) goToPage(activePage);
  }, [activePage, goToPage]);

  /*
   * Centres the current match once its page has painted a text layer.
   *
   * The mark does not exist at the moment the match changes: the page has to
   * mount, render its canvas and then its text layer. Rather than guessing a
   * delay, this retries briefly and records which match it landed on -- which
   * is also what stops it firing again. Without that guard the effect re-runs
   * every time `mountedPages` changes, i.e. on every scroll, and drags the
   * viewport back to the match the moment the user tries to look elsewhere.
   */
  const scrolledToMatch = useRef(-1);
  useEffect(() => {
    if (activeMatch < 0 || scrolledToMatch.current === activeMatch) return;

    let attempts = 0;
    let timer = 0;

    const tryScroll = () => {
      const mark = scrollRef.current?.querySelector('.find-match-active');
      if (mark) {
        mark.scrollIntoView({ block: 'center' });
        scrolledToMatch.current = activeMatch;
        return;
      }
      if (attempts < 20) {
        attempts += 1;
        timer = window.setTimeout(tryScroll, 50);
      }
    };

    tryScroll();
    return () => window.clearTimeout(timer);
  }, [activeMatch, mountedPages]);

  // -- render ---------------------------------------------------------

  if (asset.status === 'error' || error) {
    return (
      <ViewerFrame path={path}>
        <div className='flex h-full flex-col items-center justify-center gap-3 p-6 text-center'>
          <FileWarning className='size-8 text-muted-foreground' />
          <p className='text-sm text-muted-foreground'>
            Could not open {basename(path)}:{' '}
            {error ?? (asset.status === 'error' ? asset.message : '')}
          </p>
        </div>
      </ViewerFrame>
    );
  }

  const shownPage = pageDraft ?? String(currentPage);

  const jumpTo = (raw: string) => {
    const parsed = Number.parseInt(raw, 10);
    setPageDraft(null);
    if (Number.isNaN(parsed)) return;
    goToPage(clamp(parsed, 1, numPages || 1));
  };

  return (
    <ViewerFrame
      path={path}
      find
      toolbar={
        numPages > 0 && (
          <ViewerToolbar>
            <Button
              size='icon-sm'
              variant='ghost'
              title='Previous page'
              aria-label='Previous page'
              disabled={currentPage <= 1}
              onClick={() => goToPage(currentPage - 1)}
            >
              <ChevronLeft />
            </Button>
            <Input
              className='h-7 w-12 px-1 text-center text-xs tabular-nums'
              aria-label='Page number'
              value={shownPage}
              onChange={(event) => setPageDraft(event.target.value)}
              onBlur={(event) => jumpTo(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  jumpTo(event.currentTarget.value);
                  event.currentTarget.blur();
                } else if (event.key === 'Escape') {
                  setPageDraft(null);
                  event.currentTarget.blur();
                }
              }}
            />
            <ViewerToolbarReadout>of {numPages}</ViewerToolbarReadout>
            <Button
              size='icon-sm'
              variant='ghost'
              title='Next page'
              aria-label='Next page'
              disabled={currentPage >= numPages}
              onClick={() => goToPage(currentPage + 1)}
            >
              <ChevronRight />
            </Button>

            <ViewerToolbarSeparator />

            <Button
              size='icon-sm'
              variant='ghost'
              title='Zoom out'
              aria-label='Zoom out'
              onClick={() => setScale(scale - ZOOM_STEP)}
            >
              <Minus />
            </Button>
            <ViewerToolbarReadout className='w-12 text-center'>
              {Math.round(scale * 100)}%
            </ViewerToolbarReadout>
            <Button
              size='icon-sm'
              variant='ghost'
              title='Zoom in'
              aria-label='Zoom in'
              onClick={() => setScale(scale + ZOOM_STEP)}
            >
              <Plus />
            </Button>

            <ViewerToolbarSeparator />

            <Button
              size='xs'
              variant={zoom.mode === 'fit-width' ? 'default' : 'ghost'}
              aria-pressed={zoom.mode === 'fit-width'}
              title='Fit width'
              onClick={() => setZoom({ mode: 'fit-width', scale })}
            >
              Width
            </Button>
            <Button
              size='xs'
              variant={zoom.mode === 'fit-page' ? 'default' : 'ghost'}
              aria-pressed={zoom.mode === 'fit-page'}
              title='Fit page'
              onClick={() => setZoom({ mode: 'fit-page', scale })}
            >
              Page
            </Button>
          </ViewerToolbar>
        )
      }
    >
      <div
        ref={rootRef}
        data-command-surface='true'
        data-editor-id={scopeId}
        tabIndex={-1}
        onFocus={() => useActiveEditorStore.getState().setActiveEditor(scopeId)}
        onPointerDown={() => useActiveEditorStore.getState().setActiveEditor(scopeId)}
        className='absolute inset-0 outline-none'
      >
        <div ref={attachScroller} className='h-full w-full overflow-auto bg-background'>
          {file && (
            <Document
              file={file}
              onLoadSuccess={setPdf}
              onLoadError={(cause) => setError(cause.message)}
              loading={<div className='p-4 text-muted-foreground'>Loading…</div>}
              error={
                <div className='p-4 text-destructive'>This PDF could not be read.</div>
              }
            >
              {/*
                Padding lives on this column rather than on the scroller so the
                shadow of the first and last page is not clipped against the
                edge of the viewport.
              */}
              <div
                className='flex flex-col items-center'
                style={{ padding: PAGE_MARGIN, gap: PAGE_GAP }}
              >
                {Array.from({ length: numPages }, (_, index) => {
                  const pageNumber = index + 1;
                  const size = intrinsic.get(pageNumber) ?? baseSize;

                  return (
                    <PdfPage
                      key={pageNumber}
                      pageNumber={pageNumber}
                      scale={scale}
                      width={size.width * scale}
                      height={size.height * scale}
                      mounted={
                        mountedPages.has(pageNumber) ||
                        Math.abs(pageNumber - currentPage) <= NEARBY_PAGES
                      }
                      matches={matchesByPage[index]?.count ? matchesByPage[index] : undefined}
                      activeMatch={activeMatch}
                      onIntrinsicSize={onIntrinsicSize}
                      registerNode={registerNode}
                    />
                  );
                })}
              </div>
            </Document>
          )}
        </div>
      </div>
    </ViewerFrame>
  );
}
