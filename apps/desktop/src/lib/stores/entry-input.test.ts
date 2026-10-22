import { describe, expect, it } from 'vitest';
import { getPresetForName, stripPresetExtension } from '@/lib/stores/entry-input';
import { isDrawing, isTaskBoard } from '@/lib/embed/kind';

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

describe('task boards', () => {
  it('are notes with a two-part extension', () => {
    expect(getPresetForName('Groceries.task.md')?.id).toBe('task');
    expect(getPresetForName('Groceries.md')?.id).toBe('markdown');
    expect(stripPresetExtension('Groceries.task.md')).toMatchObject({ name: 'Groceries' });
  });

  it('are known by path', () => {
    expect(isTaskBoard('/v/Groceries.task.md')).toBe(true);
    expect(isTaskBoard('/v/Groceries.TASK.MD')).toBe(true);
    expect(isTaskBoard('/v/task.md')).toBe(false);
    expect(isTaskBoard('/v/Groceries.md')).toBe(false);
  });
});
