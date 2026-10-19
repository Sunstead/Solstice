import { describe, expect, it } from 'vitest';

import { arcDirection, arcPath, bandPath, fan, place, polar } from './radial';

const close = (a: number, b: number) => expect(a).toBeCloseTo(b, 6);
const UP = -Math.PI / 2;

describe('arcDirection', () => {
  it('opens upwards when the Pencil gives no angle', () => {
    close(arcDirection(undefined), UP);
  });

  it('opens away from the barrel: up and left for a right hand', () => {
    // The barrel leans down and right, toward a right hand.
    const away = arcDirection(Math.PI / 4);
    close(away, (-3 * Math.PI) / 4);
  });

  it('opens up and right for a left hand', () => {
    close(arcDirection((3 * Math.PI) / 4), -Math.PI / 4);
  });

  it('keeps to the top half, however the Pencil leans', () => {
    for (let a = -Math.PI; a <= Math.PI; a += 0.1) {
      const away = arcDirection(a);
      expect(away).toBeLessThanOrEqual(-Math.PI / 6 + 1e-9);
      expect(away).toBeGreaterThanOrEqual((-5 * Math.PI) / 6 - 1e-9);
    }
  });

  it('leans to the side the barrel isn’t on when it points straight up', () => {
    expect(Math.cos(arcDirection(-Math.PI / 2 + 0.2))).toBeLessThan(0);
    expect(Math.cos(arcDirection(-Math.PI / 2 - 0.2))).toBeGreaterThan(0);
  });
});

describe('fan', () => {
  it('spreads items around the middle', () => {
    const angles = fan(0, 3, 0.3);
    close(angles[0], -0.3);
    close(angles[1], 0);
    close(angles[2], 0.3);
  });

  it('puts one item on the middle', () => {
    expect(fan(1, 1, 0.3)).toEqual([1]);
  });
});

describe('place', () => {
  const viewport = { width: 1000, height: 800 };

  it('opens where the Pencil is when the ring fits', () => {
    expect(place({ x: 500, y: 400 }, 100, viewport, 8)).toEqual({ x: 500, y: 400 });
  });

  it('moves in from each edge and corner so the whole ring shows', () => {
    expect(place({ x: 10, y: 400 }, 100, viewport, 8)).toEqual({ x: 108, y: 400 });
    expect(place({ x: 995, y: 400 }, 100, viewport, 8)).toEqual({ x: 892, y: 400 });
    expect(place({ x: 0, y: 0 }, 100, viewport, 8)).toEqual({ x: 108, y: 108 });
    expect(place({ x: 1000, y: 800 }, 100, viewport, 8)).toEqual({ x: 892, y: 692 });
  });

  it('centres in a viewport too small for it', () => {
    expect(place({ x: 10, y: 10 }, 100, { width: 150, height: 150 }, 8)).toEqual({ x: 75, y: 75 });
  });
});

describe('polar and arcPath', () => {
  it('measures angles from the x axis, clockwise on screen', () => {
    const p = polar({ x: 10, y: 10 }, 5, Math.PI / 2);
    close(p.x, 10);
    close(p.y, 15);
  });

  it('draws the arc clockwise between two angles', () => {
    expect(arcPath({ x: 0, y: 0 }, 20, 0, Math.PI / 2)).toBe('M 20 0 A 20 20 0 0 1 0 20');
  });

  it('flags arcs over half a turn as large', () => {
    expect(arcPath({ x: 0, y: 0 }, 20, 0, Math.PI * 1.5)).toContain('A 20 20 0 1 1');
  });
});

describe('bandPath', () => {
  it('outlines a band with round ends: out along the outside, round, back along the inside, round', () => {
    const d = bandPath({ x: 0, y: 0 }, 100, 20, 0, Math.PI / 2);
    expect(d).toBe('M 110 0 A 110 110 0 0 1 0 110 A 10 10 0 0 1 0 90 A 90 90 0 0 0 90 0 A 10 10 0 0 1 110 0 Z');
  });

  it('flags a band over half a turn as large on both sides', () => {
    const d = bandPath({ x: 0, y: 0 }, 100, 20, 0, Math.PI * 1.5);
    expect(d).toContain('A 110 110 0 1 1');
    expect(d).toContain('A 90 90 0 1 0');
  });
});
