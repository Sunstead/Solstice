import { Schema } from '@milkdown/kit/prose/model';
import { describe, expect, it } from 'vitest';

import { endsInATrap } from './trailing-tap';

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { group: 'block', content: 'text*' },
    code_block: { group: 'block', content: 'text*', code: true },
    table: { group: 'block', content: 'paragraph+' },
    embed: { group: 'block', atom: true },
    text: {},
  },
});

describe('endsInATrap', () => {
  it('is a block the caret cannot get past by clicking below it', () => {
    const { nodes } = schema;
    expect(endsInATrap(nodes.code_block.create())).toBe(true);
    expect(endsInATrap(nodes.table.create(null, nodes.paragraph.create()))).toBe(true);
    expect(endsInATrap(nodes.embed.create())).toBe(true);
  });

  it('is not text you can click after, or nothing', () => {
    expect(endsInATrap(schema.nodes.paragraph.create())).toBe(false);
    expect(endsInATrap(null)).toBe(false);
  });
});
