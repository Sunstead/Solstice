/**
 * The squeeze palette's geometry: an arc of buttons beside where the Pencil
 * hovers, opening away from the hand, and fans of choices beyond it. Angles
 * are radians from the x axis, clockwise on screen (y grows down).
 */

export type Point = { x: number; y: number };

/** The arc keeps within the top half, this far from flat. */
const EDGE = Math.PI / 6;

/**
 * Which way the palette's arc opens: away from the Pencil's barrel (its
 * azimuth, so away from the hand), kept to the top half so nothing is under
 * the hand or off the bottom; straight up when there's no angle.
 */
export function arcDirection(azimuth: number | undefined): number {
  if (azimuth === undefined || !Number.isFinite(azimuth)) return -Math.PI / 2;
  let away = Math.atan2(Math.sin(azimuth + Math.PI), Math.cos(azimuth + Math.PI));
  // Pointing down: to whichever top corner is on the same side.
  if (away > 0) away = Math.cos(away) >= 0 ? -EDGE : -Math.PI + EDGE;
  return Math.min(-EDGE, Math.max(-Math.PI + EDGE, away));
}

/** Angles for `count` items spread `step` apart, centred on `mid`. */
export function fan(mid: number, count: number, step: number): number[] {
  return Array.from({ length: count }, (_, i) => mid + (i - (count - 1) / 2) * step);
}

/** The centre nearest `point` that keeps a ring of `radius` on screen, `margin` in. */
export function place(
  point: Point,
  radius: number,
  viewport: { width: number; height: number },
  margin: number,
): Point {
  const axis = (value: number, size: number) => {
    const low = radius + margin;
    const high = size - radius - margin;
    return low > high ? size / 2 : Math.min(high, Math.max(low, value));
  };
  return { x: axis(point.x, viewport.width), y: axis(point.y, viewport.height) };
}

export function polar(centre: Point, radius: number, angle: number): Point {
  return { x: centre.x + radius * Math.cos(angle), y: centre.y + radius * Math.sin(angle) };
}

const n = (value: number) => {
  const rounded = Math.round(value * 1000) / 1000;
  return Object.is(rounded, -0) ? 0 : rounded;
};

/** An SVG path along the circle of `radius`, clockwise from `start` to `end`. */
export function arcPath(centre: Point, radius: number, start: number, end: number): string {
  const large = end - start > Math.PI ? 1 : 0;
  const a = polar(centre, radius, start);
  const b = polar(centre, radius, end);
  return `M ${n(a.x)} ${n(a.y)} A ${radius} ${radius} 0 ${large} 1 ${n(b.x)} ${n(b.y)}`;
}

/**
 * The outline of a band `width` wide along the circle of `radius`, from
 * `start` to `end` clockwise, with round ends: a shape to fill or clip to
 * (a stroke can't carry a backdrop blur).
 */
export function bandPath(centre: Point, radius: number, width: number, start: number, end: number): string {
  const large = end - start > Math.PI ? 1 : 0;
  const cap = width / 2;
  const outer = radius + cap;
  const inner = radius - cap;
  const p = (r: number, a: number) => {
    const { x, y } = polar(centre, r, a);
    return `${n(x)} ${n(y)}`;
  };
  return [
    `M ${p(outer, start)}`,
    `A ${outer} ${outer} 0 ${large} 1 ${p(outer, end)}`,
    `A ${cap} ${cap} 0 0 1 ${p(inner, end)}`,
    `A ${inner} ${inner} 0 ${large} 0 ${p(inner, start)}`,
    `A ${cap} ${cap} 0 0 1 ${p(outer, start)}`,
    'Z',
  ].join(' ');
}
