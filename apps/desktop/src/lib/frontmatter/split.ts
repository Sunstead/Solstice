/**
 * A note's YAML front matter: a first line of exactly `---`, closed by the
 * next `---` or `...` line. The same rule as `split_front_matter` in
 * `crates/solstice-core/src/markdown.rs`; change the two together.
 */
export interface FrontMatterSplit {
  /** The block, both fences included, with LF line endings. */
  block: string;
  /** Everything after the closing fence's line. */
  body: string;
  /** Whether a blank line separated the block from the body. */
  blank: boolean;
  /** How much of `markdown` the block takes, its BOM and line ending included. */
  length: number;
}

export function splitFrontMatter(markdown: string): FrontMatterSplit | null {
  // micromark drops a leading BOM too, so a round trip never kept it.
  const text = markdown.replace(/^\uFEFF/, '');
  const bom = markdown.length - text.length;
  const open = /^---\r?\n/.exec(text);
  if (!open) return null;

  let offset = open[0].length;
  while (offset < text.length) {
    const newline = text.indexOf('\n', offset);
    const lineEnd = newline === -1 ? text.length : newline + 1;
    const bare = text.slice(offset, lineEnd).replace(/[\r\n]+$/, '');

    if (bare === '---' || bare === '...') {
      const body = text.slice(lineEnd);
      return {
        block: (text.slice(0, offset) + bare).replace(/\r\n/g, '\n'),
        body,
        blank: /^[ \t]*\r?\n/.test(body),
        length: bom + lineEnd,
      };
    }
    offset = lineEnd;
  }
  return null;
}

/** The YAML between the fences. */
export function frontMatterYaml(block: string): string {
  return block.split('\n').slice(1, -1).join('\n');
}
