import { describe, expect, it } from 'vitest';

import cases from '../../../../../crates/solstice-search/tests/comments.json';
import { stripComments } from './index';

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
