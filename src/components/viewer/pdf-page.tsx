import { memo, useCallback } from 'react';
import { Page } from 'react-pdf';

import { renderItemHighlights, type PageMatches } from '@/lib/pdf/search';

type PdfPageProps = {
  pageNumber: number;
  scale: number;
  /** Rendered box, so an unmounted page still holds its place in the scroll. */
  width: number;
  height: number;
  /** Within the render window; false renders a placeholder of the same size. */
  mounted: boolean;
  matches?: PageMatches;
  activeMatch: number;
  onIntrinsicSize: (pageNumber: number, size: { width: number; height: number }) => void;
  registerNode: (pageNumber: number, node: HTMLDivElement | null) => void;
};

/**
 * One page of the document.
 *
 * Pages outside the render window are genuinely unmounted rather than hidden:
 * each mounted page holds a full-resolution canvas, and a few hundred of those
 * is hundreds of megabytes. The placeholder keeps the exact box the real page
 * will occupy, so the scrollbar never jumps as pages come and go.
 */
export const PdfPage = memo(function PdfPage({
  pageNumber,
  scale,
  width,
  height,
  mounted,
  matches,
  activeMatch,
  onIntrinsicSize,
  registerNode,
}: PdfPageProps) {
  const textRenderer = useCallback(
    ({ str, itemIndex }: { str: string; itemIndex: number }) =>
      renderItemHighlights(str, matches?.byItem.get(itemIndex), activeMatch),
    [matches, activeMatch],
  );

  return (
    <div
      ref={(node) => registerNode(pageNumber, node)}
      data-page={pageNumber}
      className='solstice-pdf-page'
      style={{ width, height }}
    >
      {mounted ? (
        <Page
          pageNumber={pageNumber}
          scale={scale}
          renderAnnotationLayer={false}
          // Only handed over when there is something to paint: with no query
          // the default text layer is both faster and exactly right.
          customTextRenderer={matches ? textRenderer : undefined}
          onLoadSuccess={(page) =>
            onIntrinsicSize(pageNumber, {
              width: page.originalWidth,
              height: page.originalHeight,
            })
          }
          loading=''
        />
      ) : (
        <div className='solstice-pdf-placeholder h-full w-full text-sm'>
          {pageNumber}
        </div>
      )}
    </div>
  );
});
