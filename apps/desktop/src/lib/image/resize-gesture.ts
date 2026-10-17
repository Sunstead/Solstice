/** Narrow enough to still grab the handles, wide enough to stay an image. */
const MIN_WIDTH = 48;

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

/**
 * Dragging an image's edge handle: the width follows the pointer, held
 * between the smallest grabbable width and the column. `end` gives the width
 * to write, or null when there's nothing to write: the press was cancelled
 * (iOS took the touch for a scroll or a drag) or the width never changed.
 */
export function resizeGesture({
  startX,
  startWidth,
  maxWidth,
  direction,
}: {
  startX: number;
  startWidth: number;
  maxWidth: number;
  /** 1 for the right handle, -1 for the left. */
  direction: 1 | -1;
}) {
  let latest = startWidth;
  return {
    move(x: number): number {
      latest = clamp(startWidth + (x - startX) * direction, MIN_WIDTH, maxWidth);
      return latest;
    },
    end(cancelled: boolean): number | null {
      const width = Math.round(latest);
      return cancelled || width === Math.round(startWidth) ? null : width;
    },
  };
}
