import { useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { useNodeViewContext } from '@prosemirror-adapter/react';
import { ImageOff } from 'lucide-react';

import { useWorkspace } from '@/hooks/use-workspace';
import { resolveAsset } from '@/lib/image/resolve';
import { useWikilinkIndex } from '@/lib/stores/wikilink-index';
import { cn } from '@/lib/utils';
import { useEditorNotePath } from './editor-file-context';

/** Narrow enough to still grab the handles, wide enough to stay an image. */
const MIN_WIDTH = 48;

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

/**
 * Node view for images.
 *
 * `data-not-typeset` opts the whole subtree out of `typeset.css`, which would
 * otherwise apply its own `figure`/`img` rules on top of the resize chrome.
 * Sizing is owned by `image.css` instead.
 */
export const ImageView: React.FC = () => {
  const { node, setAttrs, selected } = useNodeViewContext();
  const notePath = useEditorNotePath();
  const workspaceRoot = useWorkspace((s) => s.path);
  // Subscribed rather than read once: a freshly pasted attachment only becomes
  // resolvable when the index rebuild that follows the write lands.
  const index = useWikilinkIndex();

  const { src, alt, title, width, height } = node.attrs;

  const asset = useMemo(
    () => resolveAsset(src, { notePath, workspaceRoot }, index),
    [src, notePath, workspaceRoot, index],
  );

  const imageRef = useRef<HTMLImageElement>(null);
  // Held locally for the length of a drag so the document isn't rewritten on
  // every pointer move -- one transaction lands on release.
  const [dragWidth, setDragWidth] = useState<number | null>(null);

  const startResize = (
    event: ReactPointerEvent<HTMLSpanElement>,
    direction: 1 | -1,
  ) => {
    const image = imageRef.current;
    if (!image) return;

    event.preventDefault();
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);

    const startX = event.clientX;
    const startWidth = image.getBoundingClientRect().width;
    const maxWidth =
      image.parentElement?.getBoundingClientRect().width ?? Number.MAX_SAFE_INTEGER;
    let latest = startWidth;

    const move = (moveEvent: PointerEvent) => {
      latest = clamp(
        startWidth + (moveEvent.clientX - startX) * direction,
        MIN_WIDTH,
        maxWidth,
      );
      setDragWidth(latest);
    };

    const finish = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', finish);
      handle.removeEventListener('pointercancel', finish);
      setDragWidth(null);

      // Height is cleared rather than kept: width alone drives the aspect
      // ratio, and a stale height would stretch the image.
      setAttrs({ width: Math.round(latest), height: null });
    };

    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', finish);
    handle.addEventListener('pointercancel', finish);
  };

  if (asset.status === 'unresolved') {
    return (
      <span
        data-not-typeset
        contentEditable={false}
        className={cn('solstice-image-missing', selected && 'is-selected')}
        title={`Could not find "${src}"`}
      >
        <ImageOff className='size-3.5 shrink-0' />
        <span className='truncate'>{src || 'No image path'}</span>
      </span>
    );
  }

  const shownWidth = dragWidth ?? width;

  return (
    <span
      data-not-typeset
      contentEditable={false}
      className={cn('solstice-image', selected && 'is-selected')}
    >
      <img
        ref={imageRef}
        src={asset.url}
        alt={alt}
        title={title || undefined}
        draggable={false}
        style={{
          width: shownWidth === null ? undefined : `${shownWidth}px`,
          height: dragWidth !== null || height === null ? undefined : `${height}px`,
        }}
      />

      {/* Double-click clears the size, which is also how it leaves the markdown. */}
      {([-1, 1] as const).map((direction) => (
        <span
          key={direction}
          className='solstice-image-handle'
          data-edge={direction === -1 ? 'left' : 'right'}
          onPointerDown={(event) => startResize(event, direction)}
          onDoubleClick={() => setAttrs({ width: null, height: null })}
        />
      ))}

      {dragWidth !== null && (
        <span className='solstice-image-readout'>{Math.round(dragWidth)}px</span>
      )}
    </span>
  );
};
