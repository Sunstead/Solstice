import { describe, expect, it } from 'vitest';

import cases from '../../../../../crates/solstice-search/tests/comments.json';
import { Schema } from '@milkdown/kit/prose/model';
import { decorate, stripComments } from './index';

describe('stripComments', () => {
  it('takes out inline and multi-paragraph comments', () => {
    expect(stripComments('Keep %%not this%% this.\n')).toBe('Keep  this.\n');
    expect(stripComments('A\n\n%%\nhidden\n\nstill hidden\n%%\n\nB\n')).toBe('A\n\n\n\nB\n');
  });

  it('leaves code alone', () => {
    expect(stripComments('`%%` stays %%gone%%\n')).toBe('`%%` stays \n');
    expect(stripComments('```sql\nLIKE \'%%\'\n```\n%%x%%y\n')).toBe('```sql\nLIKE \'%%\'\n```\ny\n');
  });

  it('leaves a note without comments as it is', () => {
    const note = '# Title\n\n100% sure\n';
    expect(stripComments(note)).toBe(note);
  });
});

// Search reads comments in Rust (`solstice-search`'s `comment_ranges`), and
// the two have to agree: both test these cases.
describe('stripComments, as search reads comments', () => {
  it.each(cases)('$input', ({ input, stripped }) => {
    expect(stripComments(input)).toBe(stripped);
  });
});

describe('comment markers in the editor', () => {
  const schema = new Schema({
    nodes: {
      doc: { content: 'paragraph+' },
      paragraph: { content: 'text*' },
      text: {},
    },
    marks: { inlineCode: {} },
  });
  const doc = (...paragraphs: string[]) =>
    schema.node('doc', null, paragraphs.map((p) => schema.node('paragraph', null, p ? schema.text(p) : [])));
  const hidden = (d: ReturnType<typeof doc>, at: number) =>
    decorate(d, { from: at, to: at })
      .find()
      // An inline decoration's attributes aren't public.
      .filter((x) => (x as unknown as { type: { attrs: { class?: string } } }).type.attrs.class === 'solstice-comment-marker')
      .map((x) => [x.from, x.to]);

  // "Keep %%not this%% this." — the comment is positions 6 to 18.
  it('hides an inline comment\'s %% while the caret is away', () => {
    expect(hidden(doc('Keep %%not this%% this.'), 1)).toEqual([
      [6, 8],
      [16, 18],
    ]);
  });

  it('shows them once the caret is in it', () => {
    expect(hidden(doc('Keep %%not this%% this.'), 10)).toEqual([]);
  });

  it('leaves a comment over several paragraphs as it is', () => {
    expect(hidden(doc('A %%open', 'still', 'shut%% B'), 1)).toEqual([]);
  });
});
