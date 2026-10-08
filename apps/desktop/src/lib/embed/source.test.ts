import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/backend', () => ({ commands: {} }));

const { sliceBlock } = await import('./source');

describe('sliceBlock', () => {
  const note = [
    '# Title',
    '',
    'First paragraph,',
    'on two lines. ^para',
    '',
    '- one',
    '- two ^item',
    '- three',
    '',
    '| a | b |',
    '| - | - |',
    '| 1 | 2 |',
    '',
    '^table',
    '',
    '```',
    'not ^here',
    '```',
  ].join('\n');

  it('takes the paragraph a marker ends', () => {
    expect(sliceBlock(note, 'para')).toBe('First paragraph,\non two lines.');
  });

  it('takes just the list item', () => {
    expect(sliceBlock(note, 'item')).toBe('- two');
  });

  it('takes the block before a marker on its own line', () => {
    expect(sliceBlock(note, 'table')).toBe('| a | b |\n| - | - |\n| 1 | 2 |');
  });

  it('finds nothing in code, or where there is no marker', () => {
    expect(sliceBlock(note, 'here')).toBeNull();
    expect(sliceBlock(note, 'missing')).toBeNull();
  });
});
