import { describe, expect, it } from 'vitest';
import { canvasGround, isVectorImage } from './kind';

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

// A drawing is white paper that goes on forever, as on the iPad, whatever
// ground the viewer gives other images.
describe('canvasGround', () => {
  it('is paper for drawings', () => {
    expect(canvasGround('/v/Ideas.drawing.svg')).toBe('paper');
    expect(canvasGround('/v/IDEAS.DRAWING.SVG')).toBe('paper');
  });

  it('is dark paper when dark paper is on', () => {
    expect(canvasGround('/v/Ideas.drawing.svg', true)).toBe('dark-paper');
    expect(canvasGround('/v/Ideas.drawing.svg', false)).toBe('paper');
  });

  it('is never dark paper for other images', () => {
    expect(canvasGround('/v/photo.png', true)).toBeUndefined();
  });

  it('is the setting for other images', () => {
    expect(canvasGround('/v/Logo.svg')).toBeUndefined();
    expect(canvasGround('/v/photo.png')).toBeUndefined();
  });
});
