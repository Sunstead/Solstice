import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { ExternalLink, FileWarning } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { useLayout } from '@/hooks/use-layout';
import { boundsOf } from '@/lib/canvas/doc';
import { parseCanvas } from '@/lib/canvas/parse';
import type { CanvasDoc } from '@/lib/canvas/types';
import { fitTo, type Viewport } from '@/lib/canvas/viewport';
import { loadEmbedSource, subscribeToEmbedSources } from '@/lib/embed/source';
import { getFileNameFromPath } from '@/lib/path-utils';
import { CanvasSurface } from './canvas-surface';
import '@/styles/canvas.css';

/**
 * A board embedded in a note: the same `CanvasSurface` the tab renders, with
 * `interactive={false}`, so a preview cannot drift from the editor.
 *
 * Fitted and inert -- panning here would fight the note's own scroll, and the
 * whole card opens the board instead.
 */

/** Boards this preview is rendered inside, outermost first. */
const CanvasChainContext = createContext<readonly string[]>([]);

/**
 * A board embedding itself, directly or through a note it transcludes, would
 * recurse until the renderer gave out. Mirrors `EmbedChainContext` in
 * `embed-view.tsx`, deliberately shallower.
 */
const MAX_CANVAS_DEPTH = 2;

/** Fixed, so a note's layout does not depend on what a board happens to hold. */
const DEFAULT_HEIGHT = 320;

const FIT_PADDING = 16;

export function CanvasPreviewCard({
  path,
  height = DEFAULT_HEIGHT,
}: {
  path: string;
  height?: number;
}) {
  const chain = useContext(CanvasChainContext);
  const hostRef = useRef<HTMLDivElement>(null);

  const [doc, setDoc] = useState<CanvasDoc | null>(null);
  const [failed, setFailed] = useState(false);
  const [width, setWidth] = useState(0);

  const name = getFileNameFromPath(path);
  const cyclic = chain.includes(path);
  const tooDeep = chain.length >= MAX_CANVAS_DEPTH;

  useEffect(() => {
    const node = hostRef.current;
    if (!node) return;

    const observer = new ResizeObserver(([entry]) =>
      setWidth(entry.contentRect.width),
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (cyclic || tooDeep) return;
    let cancelled = false;

    // Cached per path and aware of this app's writes, so a board embedded ten
    // times is read once and stays current as it is edited elsewhere.
    const read = () => {
      void loadEmbedSource(path).then((text) => {
        if (cancelled) return;
        if (text === null) {
          setFailed(true);
          return;
        }

        const parsed = parseCanvas(text);
        if (parsed.status === 'invalid') {
          setFailed(true);
          return;
        }

        setFailed(false);
        setDoc(parsed.doc);
      });
    };

    read();
    const unsubscribe = subscribeToEmbedSources(read);

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [path, cyclic, tooDeep]);

  const open = () => useLayout.getState().openFile(path, name);

  let view: Viewport | null = null;
  if (doc && width > 0) {
    view = fitTo(boundsOf(doc.nodes), { width, height }, FIT_PADDING);
  }

  return (
    <span
      className='solstice-embed-canvas'
      data-not-typeset
      contentEditable={false}
    >
      <span className='flex items-center gap-2 px-1 pb-1 text-sm text-muted-foreground'>
        <span className='min-w-0 flex-1 truncate'>{name}</span>
        {doc && (
          <span className='shrink-0 tabular-nums'>
            {doc.nodes.length} card{doc.nodes.length === 1 ? '' : 's'}
          </span>
        )}
        <Button size='xs' variant='ghost' onClick={open} title='Open in a tab'>
          <ExternalLink />
          Open
        </Button>
      </span>

      <span
        ref={hostRef}
        role='button'
        tabIndex={0}
        onClick={open}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            open();
          }
        }}
        className='block cursor-pointer overflow-hidden rounded-[var(--radius)] border'
        style={{ height }}
      >
        {cyclic || tooDeep ? (
          <span className='flex h-full items-center justify-center gap-2 p-6 text-sm text-muted-foreground'>
            <FileWarning className='size-4' />
            {cyclic ? 'Circular embed' : 'Embed nested too deeply'}
          </span>
        ) : failed ? (
          <span className='flex h-full items-center justify-center gap-2 p-6 text-sm text-muted-foreground'>
            <FileWarning className='size-4' />
            Could not read this canvas.
          </span>
        ) : (
          doc &&
          view && (
            <CanvasChainContext.Provider value={[...chain, path]}>
              <CanvasSurface
                doc={doc}
                view={view}
                sourcePath={path}
                interactive={false}
                pane={{ width, height }}
                className='size-full'
              />
            </CanvasChainContext.Provider>
          )
        )}
      </span>
    </span>
  );
}
