import { describe, expect, it } from 'vitest';
import { isVectorImage } from './kind';

// The image viewer pixelates a zoomed-in bitmap so its pixels show; a vector
// image (a drawing's SVG) is drawn sharp at any zoom instead.
describe('isVectorImage', () => {
  it('is true for SVGs, drawings included', () => {
    expect(isVectorImage('/v/Logo.svg')).toBe(true);
    expect(isVectorImage('/v/Ideas.drawing.svg')).toBe(true);
    expect(isVectorImage('/v/IDEAS.SVG')).toBe(true);
  });

  it('is false for bitmaps', () => {
    expect(isVectorImage('/v/photo.png')).toBe(false);
    expect(isVectorImage('/v/scan.jpeg')).toBe(false);
  });
});
