import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(path.resolve(__dirname, 'blank-tab.tsx'), 'utf8');

describe('the new tab page', () => {
  it('offers no canvas', () => {
    expect(source).not.toMatch(/new_canvas|canvas/i);
  });

  it('still offers a note, and opening one', () => {
    expect(source).toContain("'file.new_note'");
    expect(source).toContain("'file.open_file'");
  });
});
