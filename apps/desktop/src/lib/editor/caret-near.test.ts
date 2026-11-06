import { Schema } from '@milkdown/kit/prose/model';
import { NodeSelection, TextSelection } from '@milkdown/kit/prose/state';
import { describe, expect, it } from 'vitest';

import { textCaretNear } from './caret-near';

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { group: 'block', content: 'text*' },
    frontmatter: { group: 'block', atom: true, selectable: true },
    text: {},
  },
});

const { frontmatter, paragraph } = schema.nodes;

describe('textCaretNear', () => {
  it('never selects a block next to the drop, which what’s inserted would replace', () => {
    const doc = schema.node('doc', null, [frontmatter.create(), paragraph.create(null, schema.text('Body'))]);
    const selection = textCaretNear(doc, 0);
    expect(selection).toBeInstanceOf(TextSelection);
    expect(selection).not.toBeInstanceOf(NodeSelection);
    expect(selection?.from).toBe(2);
  });

  it('looks back when there’s only text before', () => {
    const doc = schema.node('doc', null, [paragraph.create(null, schema.text('Body')), frontmatter.create()]);
    expect(textCaretNear(doc, doc.content.size)).toBeInstanceOf(TextSelection);
  });

  it('has nowhere to go in a note with no text at all', () => {
    expect(textCaretNear(schema.node('doc', null, [frontmatter.create()]), 0)).toBeNull();
  });
});
