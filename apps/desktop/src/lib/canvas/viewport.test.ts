import { describe, expect, it } from 'vitest';
import { pinchView, toCanvas, toScreen } from '@/lib/canvas/viewport';

describe('pinchView', () => {
  const start = { scale: 1, offset: { x: 10, y: 20 } };

  it('scales by how far the fingers spread, about their midpoint', () => {
    const view = pinchView(start, [{ x: 100, y: 100 }, { x: 200, y: 100 }], [{ x: 50, y: 100 }, { x: 250, y: 100 }]);
    expect(view.scale).toBe(2);
    // The content that was under the midpoint is still there.
    const anchor = toCanvas(start, 150, 100);
    expect(toScreen(view, anchor)).toEqual({ x: 150, y: 100 });
  });

  it('pans with the midpoint when the fingers move together', () => {
    const view = pinchView(start, [{ x: 0, y: 0 }, { x: 100, y: 0 }], [{ x: 30, y: 40 }, { x: 130, y: 40 }]);
    expect(view).toEqual({ scale: 1, offset: { x: 40, y: 60 } });
  });

  it('stays within the zoom limits', () => {
    const view = pinchView(start, [{ x: 0, y: 0 }, { x: 100, y: 0 }], [{ x: 0, y: 0 }, { x: 100000, y: 0 }]);
    expect(view.scale).toBe(6);
  });
});
