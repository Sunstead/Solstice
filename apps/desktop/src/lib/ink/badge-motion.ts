/**
 * How the tool badge (`ToolBadge`) moves, as iOS moves its minimized tool
 * picker and picture in picture: dragged freely, rubber-banded past the
 * edges, and on letting go thrown to the corner it would coast to, on a
 * spring that starts at the finger's speed. Positions are the badge's
 * top-left in its area, in CSS pixels; velocities are px/s.
 */

export type Corner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
export const CORNERS: readonly Corner[] = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];

export type Point = { x: number; y: number };
/** The area the badge moves in, and its size (it's round). */
export type Area = { width: number; height: number; size: number };

export function cornerAt(corner: Corner, { width, height, size }: Area): Point {
  return {
    x: corner.endsWith('right') ? Math.max(0, width - size) : 0,
    y: corner.startsWith('bottom') ? Math.max(0, height - size) : 0,
  };
}

/** UIScrollView's normal deceleration, per millisecond. */
const DECELERATION = 0.998;

/** Where something moving at `velocity` from `at` coasts to, slowing as a scroll view does. */
export function project(at: number, velocity: number): number {
  return at + ((velocity / 1000) * DECELERATION) / (1 - DECELERATION);
}

/** The corner a badge let go at `at`, moving at `velocity`, is thrown to. */
export function nearestCorner(at: Point, velocity: Point, area: Area): Corner {
  const to = { x: project(at.x, velocity.x), y: project(at.y, velocity.y) };
  let best: Corner = 'bottom-right';
  let bestDistance = Infinity;
  for (const corner of CORNERS) {
    const c = cornerAt(corner, area);
    const distance = Math.hypot(c.x - to.x, c.y - to.y);
    if (distance < bestDistance) [best, bestDistance] = [corner, distance];
  }
  return best;
}

/** How far back the speed is measured: what the finger did just before letting go. */
const VELOCITY_WINDOW_MS = 100;

/**
 * The fastest throw counted, px/s: about a quick flick of the hand. Events
 * that arrive in a burst can measure many times that, which would send the
 * badge off the screen and toward whichever corner the noise points at.
 */
export const MAX_THROW_SPEED = 5000;

/** The drag's speed at its end, from its samples (`t` in ms), at most `MAX_THROW_SPEED`. */
export function velocityOf(samples: readonly (Point & { t: number })[]): Point {
  const last = samples[samples.length - 1];
  if (!last) return { x: 0, y: 0 };
  const first = samples.find((s) => last.t - s.t <= VELOCITY_WINDOW_MS) ?? last;
  const dt = (last.t - first.t) / 1000;
  if (dt <= 0) return { x: 0, y: 0 };
  const v = { x: (last.x - first.x) / dt, y: (last.y - first.y) / dt };
  const scale = Math.min(1, MAX_THROW_SPEED / (Math.hypot(v.x, v.y) || 1));
  return { x: v.x * scale, y: v.y * scale };
}

/**
 * `value` held to `min`..`max` with give: past an edge it moves less the
 * further it goes, never more than `dimension` beyond (UIScrollView's curve).
 */
export function rubberBand(value: number, min: number, max: number, dimension: number): number {
  const band = (over: number) => (1 - 1 / ((over * 0.55) / dimension + 1)) * dimension;
  if (value < min) return min - band(min - value);
  if (value > max) return max + band(value - max);
  return value;
}

/** The snap's spring, in SwiftUI's terms: a little bounce, settled in about half a second. */
const RESPONSE_S = 0.45;
const DAMPING_RATIO = 0.78;
const FRAME_MS = 1000 / 60;
/** Close enough to rest to stop: under a third of a pixel, and slow. */
const REST = 0.3;

/**
 * The spring from `from` to `to`, starting at `velocity`, sampled each frame
 * as keyframes (played linearly over `duration` ms), so it can run as a Web
 * Animation and still carry the throw. With `within`, a bounce past 0..`max`
 * is rubber-banded over `give` px, so a hard throw meets the edge softly.
 */
export function springKeyframes(
  from: Point,
  to: Point,
  velocity: Point,
  within?: { max: Point; give: number },
): { frames: Point[]; duration: number } {
  const omega = (2 * Math.PI) / RESPONSE_S;
  const zeta = DAMPING_RATIO;
  const omegaD = omega * Math.sqrt(1 - zeta * zeta);
  // The underdamped spring's displacement from rest, and its speed.
  const axis = (x0: number, v0: number) => (t: number) => {
    const decay = Math.exp(-zeta * omega * t);
    const b = (v0 + zeta * omega * x0) / omegaD;
    const cos = Math.cos(omegaD * t);
    const sin = Math.sin(omegaD * t);
    const x = decay * (x0 * cos + b * sin);
    const v = decay * (-zeta * omega * (x0 * cos + b * sin) + (-x0 * omegaD * sin + b * omegaD * cos));
    return { x, v };
  };
  const ax = axis(from.x - to.x, velocity.x);
  const ay = axis(from.y - to.y, velocity.y);

  const frames: Point[] = [from];
  // Banded only once in bounds: let go past an edge (rubber-banded by the
  // drag, more loosely), it comes back from there without a jump.
  const inside = { x: false, y: false };
  for (let i = 1; i < 300; i++) {
    const t = (i * FRAME_MS) / 1000;
    const [x, y] = [ax(t), ay(t)];
    if (Math.hypot(x.x, y.x) < REST && Math.hypot(x.v, y.v) < REST * 60) break;
    const at = { x: to.x + x.x, y: to.y + y.x };
    if (within) {
      inside.x ||= at.x >= 0 && at.x <= within.max.x;
      inside.y ||= at.y >= 0 && at.y <= within.max.y;
      if (inside.x) at.x = rubberBand(at.x, 0, within.max.x, within.give);
      if (inside.y) at.y = rubberBand(at.y, 0, within.max.y, within.give);
    }
    frames.push(at);
  }
  frames.push(to);
  return { frames, duration: (frames.length - 1) * FRAME_MS };
}
