import { describe, expect, it } from 'vitest';

import {
  cornerAt,
  MAX_THROW_SPEED,
  nearestCorner,
  project,
  rubberBand,
  springKeyframes,
  velocityOf,
} from './badge-motion';

const area = { width: 800, height: 600, size: 48 };

describe('cornerAt', () => {
  it('puts the badge flush in each corner of its area', () => {
    expect(cornerAt('top-left', area)).toEqual({ x: 0, y: 0 });
    expect(cornerAt('bottom-right', area)).toEqual({ x: 752, y: 552 });
    expect(cornerAt('top-right', area)).toEqual({ x: 752, y: 0 });
    expect(cornerAt('bottom-left', area)).toEqual({ x: 0, y: 552 });
  });
});

describe('throwing to a corner', () => {
  it('goes to the corner nearest where it was let go, when let go still', () => {
    expect(nearestCorner({ x: 500, y: 100 }, { x: 0, y: 0 }, area)).toBe('top-right');
    expect(nearestCorner({ x: 100, y: 400 }, { x: 0, y: 0 }, area)).toBe('bottom-left');
  });

  it('goes where a flick would carry it, not where it was let go', () => {
    // Let go near the top left, flicked hard right and down.
    expect(nearestCorner({ x: 100, y: 100 }, { x: 2000, y: 1500 }, area)).toBe('bottom-right');
    // A gentle nudge doesn't carry it across.
    expect(nearestCorner({ x: 100, y: 100 }, { x: 100, y: 0 }, area)).toBe('top-left');
  });

  it('coasts as a scroll view does', () => {
    // UIScrollView's normal rate: 1000 pt/s coasts about half a screen.
    expect(project(0, 1000)).toBeCloseTo(499, 0);
    expect(project(10, 0)).toBe(10);
  });
});

describe('velocityOf', () => {
  it('measures over the last moments of the drag, in px/s', () => {
    const samples = [
      { x: 0, y: 0, t: 0 },
      { x: 10, y: 0, t: 200 },
      { x: 20, y: 5, t: 250 },
      { x: 40, y: 15, t: 300 },
    ];
    const v = velocityOf(samples);
    // From t 200 to 300: only the last 100 ms count.
    expect(v.x).toBeCloseTo(300);
    expect(v.y).toBeCloseTo(150);
  });

  it('caps a spike at the speed of a hand, keeping its direction', () => {
    // Events that arrived in a burst: 140 px in 1 ms.
    const v = velocityOf([{ x: 0, y: 0, t: 0 }, { x: 140, y: 4, t: 1 }]);
    expect(Math.hypot(v.x, v.y)).toBeCloseTo(MAX_THROW_SPEED);
    expect(v.y / v.x).toBeCloseTo(4 / 140);
    // So a flick right from the top left goes to the top right.
    expect(nearestCorner({ x: 140, y: 4 }, v, area)).toBe('top-right');
  });

  it('is still when the finger rested before letting go', () => {
    expect(velocityOf([{ x: 0, y: 0, t: 0 }, { x: 50, y: 0, t: 10 }, { x: 50, y: 0, t: 300 }])).toEqual({ x: 0, y: 0 });
    expect(velocityOf([])).toEqual({ x: 0, y: 0 });
  });
});

describe('rubberBand', () => {
  it('follows freely inside, and resists ever more past an edge', () => {
    expect(rubberBand(100, 0, 500, 300)).toBe(100);
    const a = rubberBand(-50, 0, 500, 300);
    const b = rubberBand(-500, 0, 500, 300);
    expect(a).toBeLessThan(0);
    expect(a).toBeGreaterThan(-50);
    expect(b).toBeLessThan(a);
    expect(b).toBeGreaterThan(-300);
    expect(rubberBand(550, 0, 500, 300)).toBeGreaterThan(500);
    expect(rubberBand(550, 0, 500, 300)).toBeLessThan(550);
  });
});

describe('springKeyframes', () => {
  it('starts where it is and ends on the corner', () => {
    const { frames, duration } = springKeyframes({ x: 100, y: 50 }, { x: 0, y: 0 }, { x: 0, y: 0 });
    expect(frames[0]).toEqual({ x: 100, y: 50 });
    expect(frames[frames.length - 1]).toEqual({ x: 0, y: 0 });
    expect(duration).toBeGreaterThan(200);
    expect(duration).toBeLessThan(1500);
  });

  it('carries the throw: a flick toward the corner overshoots a little, then settles', () => {
    const { frames } = springKeyframes({ x: 100, y: 0 }, { x: 0, y: 0 }, { x: -3000, y: 0 });
    const lowest = Math.min(...frames.map((f) => f.x));
    expect(lowest).toBeLessThan(0);
    expect(lowest).toBeGreaterThan(-40);
  });

  it('gives against the edge rather than sailing past it', () => {
    const from = { x: 100, y: 0 };
    const free = springKeyframes(from, { x: 0, y: 0 }, { x: -5000, y: 0 });
    const held = springKeyframes(from, { x: 0, y: 0 }, { x: -5000, y: 0 }, { max: { x: 752, y: 552 }, give: 48 });
    const lowest = (frames: { x: number }[]) => Math.min(...frames.map((f) => f.x));
    expect(lowest(free.frames)).toBeLessThan(-80);
    expect(lowest(held.frames)).toBeLessThan(0);
    expect(lowest(held.frames)).toBeGreaterThan(-30);
    expect(held.frames[held.frames.length - 1]).toEqual({ x: 0, y: 0 });
  });

  it('comes back from past an edge without a jump', () => {
    const { frames } = springKeyframes({ x: -40, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }, { max: { x: 752, y: 552 }, give: 48 });
    expect(frames[1].x).toBeLessThan(-30);
  });

  it('keeps going the way it was thrown before turning back', () => {
    // Thrown away from the corner it's headed to.
    const { frames } = springKeyframes({ x: 100, y: 0 }, { x: 0, y: 0 }, { x: 1500, y: 0 });
    expect(frames[1].x).toBeGreaterThan(100);
  });
});
