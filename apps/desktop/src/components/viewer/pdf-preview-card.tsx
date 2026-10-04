import { useEffect, useMemo, useRef, useState } from 'react';
import { Document, Page } from 'react-pdf';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { ExternalLink, FileWarning } from 'lucide-react';

import { Button } from '@sunstead/ui/components/button';
import { useLayout } from '@/hooks/use-layout';
import { getFileNameFromPath } from '@/lib/path-utils';
import { useAssetUrl } from '@/lib/viewer/asset';
import '@/lib/pdf/worker';

/**
 * A PDF embedded in a note.
 *
 * Deliberately only the first page. The inline embed used to be an `<iframe>`
 * carrying a whole platform PDF reader, and a note with several of them was a
 * note with several PDF readers scrolling independently inside it. A cover
 * page says which document this is, which is what an embed is for; the button
 * opens the real viewer for anyone who wants to read it.
 */
export function PdfPreviewCard({ path, height }: { path: string; height?: number }) {
  const asset = useAssetUrl(path);
  const hostRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [pageCount, setPageCount] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);

  const name = getFileNameFromPath(path);

  useEffect(() => {
    const node = hostRef.current;
    if (!node) return;

    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  // Keyed on the URL string, not the asset object: react-pdf reloads the whole
  // document whenever this changes identity, so it must not churn just because
  // the hook re-created an otherwise identical result.
  const url = asset.status === 'ready' ? asset.url : null;
  const file = useMemo(() => (url ? { url } : null), [url]);

  const open = () => useLayout.getState().openFile(path, name);

  return (
    <span className='solstice-embed-pdf' data-not-typeset contentEditable={false}>
      <span className='flex items-center gap-2 px-1 pb-1 text-sm text-muted-foreground'>
        <span className='min-w-0 flex-1 truncate'>{name}</span>
        {pageCount !== null && (
          <span className='shrink-0 tabular-nums'>
            {pageCount} page{pageCount === 1 ? '' : 's'}
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
        className='block cursor-pointer overflow-hidden rounded-[var(--radius)] border bg-muted'
        style={{ maxHeight: height }}
      >
        {failed ? (
          <span className='flex items-center justify-center gap-2 p-6 text-sm text-muted-foreground'>
            <FileWarning className='size-4' />
            Could not read this PDF.
          </span>
        ) : (
          file &&
          width > 0 && (
            <Document
              file={file}
              onLoadSuccess={(pdf: PDFDocumentProxy) => setPageCount(pdf.numPages)}
              onLoadError={() => setFailed(true)}
              loading=''
              error=''
            >
              <Page
                pageNumber={1}
                width={width}
                renderTextLayer={false}
                renderAnnotationLayer={false}
                loading=''
              />
            </Document>
          )
        )}
      </span>
    </span>
  );
}
