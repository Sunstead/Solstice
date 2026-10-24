import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(path.resolve(__dirname, 'typography-pane.tsx'), 'utf8');

// A container query never matches the container itself: with the container and
// the row on one element, the row stayed a column and the preview, 23rem wide
// and sticky, rode over the settings.
describe('the typography pane', () => {
  it('measures its row from a container around it', () => {
    const container = source.match(/<div className='([^']*)'>\s*<div className='([^']*@xl:flex-row-reverse[^']*)'/);
    expect(container).not.toBeNull();
    expect(container![1]).toContain('@container');
    expect(container![2]).not.toContain('@container');
  });

  it('puts the preview beside the settings, on the right', () => {
    expect(source).toContain('@xl:flex-row-reverse');
    expect(source).toContain('@xl:sticky');
  });
});
