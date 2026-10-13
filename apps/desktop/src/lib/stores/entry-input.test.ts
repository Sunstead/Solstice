import { describe, expect, it } from 'vitest';
import { getPresetForName, stripPresetExtension } from '@/lib/stores/entry-input';
import { isDrawing } from '@/lib/embed/kind';

describe('presets by name', () => {
  it('finds a two-part extension before its last part', () => {
    expect(getPresetForName('Sketch.drawing.svg')?.id).toBe('drawing');
    expect(getPresetForName('logo.svg')).toBeNull();
    expect(getPresetForName('Board.canvas')?.id).toBe('canvas');
  });

  it("strips a drawing's whole extension", () => {
    expect(stripPresetExtension('Sketch.drawing.svg')).toMatchObject({ name: 'Sketch' });
    expect(stripPresetExtension('Note.md').name).toBe('Note');
    // Not a drawing: only its own last extension, and svg has no preset.
    expect(stripPresetExtension('logo.svg').name).toBe('logo.svg');
  });

  it('a file named only ".drawing.svg" is not a drawing preset', () => {
    expect(getPresetForName('.drawing.svg')?.id).not.toBe('drawing');
  });
});

describe('isDrawing', () => {
  it('knows drawings by their compound extension', () => {
    expect(isDrawing('/v/Ideas.drawing.svg')).toBe(true);
    expect(isDrawing('/v/Ideas.DRAWING.SVG')).toBe(true);
    expect(isDrawing('/v/logo.svg')).toBe(false);
  });
});
