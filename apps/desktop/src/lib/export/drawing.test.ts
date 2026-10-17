import { describe, expect, it } from 'vitest';
import { drawingPage, imageScale, svgSize } from './drawing';

const svg = (attrs: string) => `<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg" ${attrs}><rect/></svg>`;

describe('svgSize', () => {
  it('reads the size a drawing gives itself', () => {
    expect(svgSize(svg('viewBox="-10 5 300.5 200" width="300.5" height="200"'))).toEqual({ width: 300.5, height: 200 });
  });

  it('falls back to the viewBox, and to a page when there is neither', () => {
    expect(svgSize(svg('viewBox="0 0 640 480"'))).toEqual({ width: 640, height: 480 });
    expect(svgSize(svg(''))).toEqual({ width: 1024, height: 768 });
  });
});

describe('imageScale', () => {
  it('draws at twice the size, sharp on any screen', () => {
    expect(imageScale({ width: 800, height: 600 })).toBe(2);
  });

  it('stays inside what a canvas can hold', () => {
    const scale = imageScale({ width: 10000, height: 3000 });
    expect(10000 * scale).toBeLessThanOrEqual(8192);
  });
});

describe('drawingPage', () => {
  it('is the drawing’s own size, with no margin', () => {
    expect(drawingPage({ width: 300, height: 200 })).toEqual({ width: 300, height: 200, margin: 0 });
  });
});
