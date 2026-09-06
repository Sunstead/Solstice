import { useEffect, useLayoutEffect, useRef, useState } from 'react';

import { gridCellForScale } from '@/lib/canvas/grid';
import { useResolvedColors } from '@/lib/canvas/use-resolved-color';

const DOT_RADIUS = 1;

/**
 * The dot surface an image or a canvas board sits on.
 *
 * Drawn on a canvas rather than as a tiled CSS background. The background
 * version is smooth in Chromium and jitters in WKWebView, which is why it
 * looked right in the previous Electron build of this app and wrong here:
 * WebKit rounds each background tile's origin to device pixels, so a tile whose
 * fractional size drifts every frame lands individual dots a pixel out and
 * snaps them back. A canvas has no tile -- every dot centre is a float the
 * rasteriser antialiases directly -- so there is nothing to round.
 *
 * `offset` is the screen position of the content's origin, which with a `0 0`
 * transform origin is exactly the translation applied to the content, so dots
 * land on content coordinates that are whole multiples of the cell and stay
 * welded to the image through any pan or zoom.
 *
 * The cell comes from `gridCellForScale` rather than being computed here, so
 * the canvas editor snaps to the same lattice it can see. Both surfaces render
 * their content and this layer from one `scale`/`offset` pair in one commit,
 * so nothing can disagree about where anything is.
 */
export function CanvasGrid({
  scale,
  offset,
}: {
  scale: number;
  offset: { x: number; y: number };
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  /*
   * `color: var(--ring)` on the element resolves the theme variable to a value
   * the canvas will accept as a fill. Shared with the minimap, which is also a
   * canvas and has the same problem.
   */
  const colors = useResolvedColors(canvasRef, ['color']);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const observer = new ResizeObserver(([entry]) =>
      setSize({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      }),
    );

    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context || !size.width || !size.height) return;

    const dpr = window.devicePixelRatio || 1;
    const backingWidth = Math.round(size.width * dpr);
    const backingHeight = Math.round(size.height * dpr);

    // Assigning either dimension clears the canvas, so only do it on a change.
    if (canvas.width !== backingWidth) canvas.width = backingWidth;
    if (canvas.height !== backingHeight) canvas.height = backingHeight;

    const spacing = gridCellForScale(scale) * scale;
    if (!Number.isFinite(spacing) || spacing <= 0) return;

    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, size.width, size.height);

    // First dot at or before each edge. `%` keeps the sign of the operand, so
    // a positive remainder has to be pulled back a cell to start off-screen.
    let startX = offset.x % spacing;
    if (startX > 0) startX -= spacing;
    let startY = offset.y % spacing;
    if (startY > 0) startY -= spacing;

    // One path, one fill. A `beginPath`/`fill` per dot is thousands of draw
    // calls a frame; this is a single one.
    const path = new Path2D();
    for (let x = startX; x <= size.width; x += spacing) {
      for (let y = startY; y <= size.height; y += spacing) {
        path.moveTo(x + DOT_RADIUS, y);
        path.arc(x, y, DOT_RADIUS, 0, Math.PI * 2);
      }
    }

    context.fillStyle = colors.current.color || 'currentColor';
    context.fill(path);
  }, [scale, offset, size, colors.version]);

  return <canvas ref={canvasRef} aria-hidden className='solstice-canvas-grid' />;
}
