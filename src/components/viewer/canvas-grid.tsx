/**
 * The dot surface an image sits on.
 *
 * Ported from the canvas editor's grid, which is where this technique is
 * proven. `offset` is the screen position of the content's origin -- which,
 * with a `0 0` transform origin, is exactly the translation applied to the
 * content -- so the dots land on content coordinates that are whole multiples
 * of the cell, welded to the picture through any pan or zoom.
 *
 * The cell is a power of two, so zooming *subdivides*: each cell is half the
 * last, and every existing dot survives while new ones appear between them.
 * `Math.min(scale, 1)` stops that above 1:1, where a subdivision would reveal
 * half the dots on screen at once for no benefit.
 */
export function CanvasGrid({
  scale,
  offset,
}: {
  scale: number;
  offset: { x: number; y: number };
}) {
  const targetPixelSpacing = 30;

  const rawWorldGridSize = targetPixelSpacing / Math.min(scale, 1);
  const worldGridSize = Math.pow(2, Math.round(Math.log2(rawWorldGridSize)));
  const scaledGridSize = worldGridSize * scale;

  const gridOffsetX = offset.x % scaledGridSize;
  const gridOffsetY = offset.y % scaledGridSize;

  return (
    <div
      aria-hidden
      className='solstice-canvas-grid'
      style={{
        backgroundImage: 'radial-gradient(var(--ring) 1px, rgba(0, 0, 0, 0) 0px)',
        backgroundSize: `${scaledGridSize}px ${scaledGridSize}px`,
        backgroundPosition: `${gridOffsetX + scaledGridSize / 2}px ${gridOffsetY + scaledGridSize / 2}px`,
      }}
    />
  );
}
