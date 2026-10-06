import { useCallback, useEffect, useRef, useState } from 'react';
import { ImageOff, Minus, Plus } from 'lucide-react';

import { Button } from '@sunstead/ui/components/button';
import { useAssetUrl } from '@/lib/viewer/asset';
import { basename } from '@/lib/wikilink/target';
import { pinchView, type Viewport } from '@/lib/canvas/viewport';
import type { Point } from '@/lib/canvas/types';
import { CanvasGrid } from './canvas-grid';
import { ViewerFrame } from './viewer-frame';
import {
  ViewerToolbar,
  ViewerToolbarReadout,
  ViewerToolbarSeparator,
} from './viewer-toolbar';

/** Breathing room left around a fitted image, so it never touches the edges. */
const FIT_PADDING = 32;

const MIN_SCALE = 0.1;
const MAX_SCALE = 10;

/**
 * Zoom per wheel event, by input device.
 *
 * Keyed on the *sign* of the delta only, never its magnitude. A trackpad's
 * `deltaY` stream is noisy, so scaling by it makes each frame's zoom step a
 * different size -- the picture survives that, but a regular lattice of dots
 * shows every irregularity as jitter. Even geometric steps keep the grid
 * changing at a constant rate.
 */
const TOUCHPAD_STEP = 1.03;
const MOUSE_STEP = 1.2;

/** Below this delta the event came from a trackpad, not a wheel notch. */
const TOUCHPAD_DELTA = 50;

/** Past this, the image is being inspected pixel by pixel; stop smoothing it. */
const PIXELATE_ABOVE = 2;

/** Stops the zoom buttons step through, in even increments where it matters. */
const ZOOM_STOPS = [
  0.1, 0.15, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5, 6, 8, 10,
];

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

/**
 * A viewer for image files opened as their own tab.
 *
 * The pan/zoom model is the canvas editor's: `offset` is the screen position
 * of the content's origin, the content is transformed about `0 0`, and the dot
 * grid reads that offset directly. Both are rendered from the same state in
 * the same commit, so nothing can disagree about where the picture is.
 */
export function ImageViewer({ path }: { path: string }) {
  const asset = useAssetUrl(path);

  const containerRef = useRef<HTMLDivElement>(null);

  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [image, setImage] = useState({ width: 0, height: 0 });
  const [pane, setPane] = useState({ width: 0, height: 0 });

  // Read by the wheel handler, which is bound once and must not close over
  // stale values.
  const scaleRef = useRef(scale);
  scaleRef.current = scale;
  const offsetRef = useRef(offset);
  offsetRef.current = offset;

  const draggingRef = useRef(false);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;

    const observer = new ResizeObserver(([entry]) =>
      setPane({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      }),
    );

    observer.observe(node);
    const box = node.getBoundingClientRect();
    setPane({ width: box.width, height: box.height });

    return () => observer.disconnect();
  }, []);

  /** Centres the image at the largest scale leaving `FIT_PADDING` clear. */
  const fit = useCallback(() => {
    if (!image.width || !image.height || !pane.width || !pane.height) return;

    const next = clamp(
      Math.min(
        (pane.width - FIT_PADDING * 2) / image.width,
        (pane.height - FIT_PADDING * 2) / image.height,
      ),
      MIN_SCALE,
      MAX_SCALE,
    );

    setScale(next);
    setOffset({
      x: (pane.width - image.width * next) / 2,
      y: (pane.height - image.height * next) / 2,
    });
  }, [image, pane]);

  /*
   * Fitted on open and whenever the file changes.
   *
   * `pane` is read but deliberately left out of the dependencies: dragging a
   * split pane should not throw away the zoom and position the reader had
   * settled on, so a resize alone must not refit.
   */
  useEffect(() => {
    if (image.width && pane.width) fit();
  }, [image, path]);

  /** Zooms about a point in client coordinates, holding it still on screen. */
  const zoomAbout = useCallback(
    (nextScale: number, clientX: number, clientY: number) => {
      const node = containerRef.current;
      if (!node) return;

      const current = scaleRef.current;
      const currentOffset = offsetRef.current;
      const next = clamp(nextScale, MIN_SCALE, MAX_SCALE);
      if (next === current) return;

      const box = node.getBoundingClientRect();
      const mouseX = clientX - box.left;
      const mouseY = clientY - box.top;

      // The content coordinate under the pointer, which must not move.
      const pointTo = {
        x: (mouseX - currentOffset.x) / current,
        y: (mouseY - currentOffset.y) / current,
      };

      setScale(next);
      setOffset({
        x: mouseX - pointTo.x * next,
        y: mouseY - pointTo.y * next,
      });
    },
    [],
  );

  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();

      // A trackpad pinch arrives as a wheel event with `ctrlKey` set, so both
      // gestures land here without a second code path.
      if (event.ctrlKey || event.metaKey) {
        const step =
          Math.abs(event.deltaY) < TOUCHPAD_DELTA ? TOUCHPAD_STEP : MOUSE_STEP;
        const current = scaleRef.current;

        zoomAbout(
          event.deltaY > 0 ? current / step : current * step,
          event.clientX,
          event.clientY,
        );
        return;
      }

      let dx = -event.deltaX;
      let dy = -event.deltaY;
      if (event.shiftKey) {
        dx = dy;
        dy = 0;
      }

      setOffset((previous) => ({ x: previous.x + dx, y: previous.y + dy }));
    };

    // Not passive: the page must not scroll underneath the gesture.
    node.addEventListener('wheel', onWheel, { passive: false });
    return () => node.removeEventListener('wheel', onWheel);
  }, [zoomAbout]);

  // Touch: one finger pans, two pinch (zoom with the spread, pan with the
  // midpoint). The mouse keeps its own handlers below.
  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    const fingers = new Map<number, Point>();
    let start: { view: Viewport; from: Point[] } | null = null;
    const paneOf = (e: PointerEvent): Point => {
      const box = node.getBoundingClientRect();
      return { x: e.clientX - box.left, y: e.clientY - box.top };
    };
    const begin = () => {
      start = {
        view: { scale: scaleRef.current, offset: { ...offsetRef.current } },
        from: [...fingers.values()],
      };
    };
    const onDown = (e: PointerEvent) => {
      if (e.pointerType !== 'touch') return;
      fingers.set(e.pointerId, paneOf(e));
      begin();
    };
    const onMove = (e: PointerEvent) => {
      if (!fingers.has(e.pointerId) || !start) return;
      fingers.set(e.pointerId, paneOf(e));
      const now = [...fingers.values()];
      if (now.length >= 2 && start.from.length >= 2) {
        const view = pinchView(start.view, [start.from[0], start.from[1]], [now[0], now[1]], {
          min: MIN_SCALE,
          max: MAX_SCALE,
        });
        setScale(view.scale);
        setOffset(view.offset);
      } else if (now.length === 1 && start.from.length === 1) {
        setOffset({
          x: start.view.offset.x + now[0].x - start.from[0].x,
          y: start.view.offset.y + now[0].y - start.from[0].y,
        });
      }
    };
    const onUp = (e: PointerEvent) => {
      if (!fingers.delete(e.pointerId)) return;
      // Whatever fingers are left carry on from here.
      if (fingers.size > 0) begin();
      else start = null;
    };
    node.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      node.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, []);

  const stepZoom = useCallback(
    (direction: 1 | -1) => {
      const node = containerRef.current;
      if (!node) return;

      const current = scaleRef.current;
      // A tolerance, so landing exactly on a stop does not make the next press
      // a no-op against floating-point noise.
      const next =
        direction > 0
          ? (ZOOM_STOPS.find((stop) => stop > current + 1e-4) ?? MAX_SCALE)
          : (ZOOM_STOPS.filter((stop) => stop < current - 1e-4).pop() ?? MIN_SCALE);

      // About the middle of the pane: pressing `+` while inspecting a corner
      // should not throw the view into the centre of the picture.
      const box = node.getBoundingClientRect();
      zoomAbout(next, box.left + box.width / 2, box.top + box.height / 2);
    },
    [zoomAbout],
  );

  const actualSize = useCallback(() => {
    const node = containerRef.current;
    if (!node) return;
    const box = node.getBoundingClientRect();
    zoomAbout(1, box.left + box.width / 2, box.top + box.height / 2);
  }, [zoomAbout]);

  /**
   * Panning, throttled to one update per frame.
   *
   * The position is recomputed from where the drag started rather than
   * accumulated per event, so a dropped or coalesced move cannot leave the
   * image drifting away from the pointer.
   */
  const onMouseDown = useCallback((event: React.MouseEvent) => {
    if (event.button > 2) return;
    event.preventDefault();

    draggingRef.current = true;
    const start = { x: event.clientX, y: event.clientY };
    const from = { ...offsetRef.current };

    const onMove = (move: MouseEvent) => {
      if (!draggingRef.current) return;

      const desired = {
        x: from.x + (move.clientX - start.x),
        y: from.y + (move.clientY - start.y),
      };

      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        setOffset((previous) =>
          previous.x === desired.x && previous.y === desired.y ? previous : desired,
        );
      });
    };

    const onUp = () => {
      draggingRef.current = false;
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, []);

  if (asset.status === 'error') {
    return (
      <ViewerFrame path={path}>
        <div className='flex h-full flex-col items-center justify-center gap-3 p-6 text-center'>
          <ImageOff className='size-8 text-muted-foreground' />
          <p className='text-sm text-muted-foreground'>
            Could not load {basename(path)}: {asset.message}
          </p>
        </div>
      </ViewerFrame>
    );
  }

  return (
    <ViewerFrame
      path={path}
      toolbar={
        <ViewerToolbar>
          <Button
            size='icon-sm'
            variant='ghost'
            title='Zoom out'
            aria-label='Zoom out'
            onClick={() => stepZoom(-1)}
          >
            <Minus />
          </Button>
          {/* Fixed width so the toolbar does not twitch between 10% and 100%. */}
          <ViewerToolbarReadout className='w-12 text-center'>
            {Math.round(scale * 100)}%
          </ViewerToolbarReadout>
          <Button
            size='icon-sm'
            variant='ghost'
            title='Zoom in'
            aria-label='Zoom in'
            onClick={() => stepZoom(1)}
          >
            <Plus />
          </Button>

          <ViewerToolbarSeparator />

          <Button size='xs' variant='ghost' title='Fit to window (0)' onClick={fit}>
            Fit
          </Button>
          <Button size='xs' variant='ghost' title='Actual size (1)' onClick={actualSize}>
            1:1
          </Button>
        </ViewerToolbar>
      }
    >
      <div
        ref={containerRef}
        tabIndex={0}
        className='solstice-canvas absolute inset-0 cursor-default touch-none overflow-hidden outline-none active:cursor-grabbing'
        onMouseDown={onMouseDown}
        // Right-drag pans, so the OS menu must not open on top of the gesture.
        onContextMenu={(event) => event.preventDefault()}
        onDoubleClick={() => (Math.abs(scale - 1) < 0.001 ? fit() : actualSize())}
        onKeyDown={(event) => {
          if (event.key === '0') fit();
          else if (event.key === '1') actualSize();
          else return;
          event.preventDefault();
        }}
      >
        <CanvasGrid scale={scale} offset={offset} />

        {asset.status === 'ready' && (
          <div
            className='absolute size-0'
            style={{
              transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
              // The whole model rests on this: with a `0 0` origin the
              // translation *is* where the image's corner lands, which is what
              // the grid anchors to.
              transformOrigin: '0 0',
            }}
          >
            <img
              src={asset.url}
              alt={basename(path)}
              draggable={false}
              className='max-w-none select-none'
              onLoad={(event) =>
                setImage({
                  width: event.currentTarget.naturalWidth,
                  height: event.currentTarget.naturalHeight,
                })
              }
              style={{
                imageRendering: scale > PIXELATE_ABOVE ? 'pixelated' : 'auto',
              }}
            />
          </div>
        )}
      </div>
    </ViewerFrame>
  );
}
