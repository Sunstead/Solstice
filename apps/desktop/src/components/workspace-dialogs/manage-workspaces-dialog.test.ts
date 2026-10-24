import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(path.resolve(__dirname, 'manage-workspaces-dialog.tsx'), 'utf8');

// The open workspace has a label where the others have the options button (40px
// on touch), and one being removed has neither, so rows differed in height.
describe('the workspace rows', () => {
  it('are as tall as the options button, whatever they hold', () => {
    expect(source).toMatch(/className='flex min-h-8 items-center gap-2 touch:min-h-10'/);
  });
});
