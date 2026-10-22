import { describe, expect, it } from 'vitest';

import { typeExtension } from '@/lib/utils';

describe('typeExtension', () => {
  const known = ['md', 'svg', 'drawing.svg', 'task.md'];

  it('prefers a known two-part extension', () => {
    expect(typeExtension('Groceries.task.md', known)).toBe('task.md');
    expect(typeExtension('Sketch.DRAWING.svg', known)).toBe('drawing.svg');
  });

  it('falls back to the last extension', () => {
    expect(typeExtension('Note.md', known)).toBe('md');
    expect(typeExtension('logo.svg', known)).toBe('svg');
    expect(typeExtension('archive.tar.gz', known)).toBe('gz');
    expect(typeExtension('README', known)).toBe('');
  });

  it('needs a name before the extension', () => {
    expect(typeExtension('.task.md', known)).toBe('md');
  });
});
