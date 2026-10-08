// @vitest-environment jsdom
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { Editor } from '@milkdown/kit/core';

import { splitFrontMatter } from './split';

// The editor's plugin list reaches the PDF viewer, which jsdom can't load.
vi.mock('react-pdf', () => ({ Document: () => null, Page: () => null, pdfjs: { GlobalWorkerOptions: {} } }));
vi.mock('@/lib/pdf/worker', () => ({}));

describe('splitFrontMatter', () => {
  // The same cases as `split_front_matter` in solstice-core.
  it('splits front matter', () => {
    expect(splitFrontMatter('---\ntitle: Plan\ntags: [a]\n---\n# Heading\n')).toEqual({
      block: '---\ntitle: Plan\ntags: [a]\n---',
      body: '# Heading\n',
      blank: false,
      length: 30,
    });
    expect(splitFrontMatter('---\r\ntitle: x\r\n...\r\nbody')).toEqual({
      block: '---\ntitle: x\n...',
      body: 'body',
      blank: false,
      length: 20,
    });
  });

  it('leaves notes without front matter alone', () => {
    expect(splitFrontMatter('# Hi\n---\n')).toBeNull();
    expect(splitFrontMatter('---\nnot closed\n')).toBeNull();
    expect(splitFrontMatter('--- \nx\n---\n')).toBeNull();
  });

  it('takes empty front matter, and a closing fence at the end', () => {
    expect(splitFrontMatter('---\n---\n\nText')).toEqual({ block: '---\n---', body: '\nText', blank: true, length: 8 });
    expect(splitFrontMatter('\uFEFF---\na: 1\n---')).toEqual({ block: '---\na: 1\n---', body: '', blank: false, length: 13 });
  });
});

describe('the editor', () => {
  let editor: Editor;

  beforeAll(async () => {
    (globalThis as { DOMMatrix?: unknown }).DOMMatrix ??= class {};
    const { Editor, rootCtx } = await import('@milkdown/kit/core');
    const { commonmark } = await import('@milkdown/kit/preset/commonmark');
    const { gfm } = await import('@milkdown/kit/preset/gfm');
    const { wikilink } = await import('@/lib/wikilink');
    const { editorOuterMarks, editorSchemaPlugins } = await import('@/lib/editor/plugins');
    editor = await Editor.make()
      .config((ctx) => ctx.set(rootCtx, document.createElement('div')))
      .use(editorOuterMarks())
      .use(commonmark)
      .use(gfm)
      .use(wikilink)
      .use(editorSchemaPlugins())
      .create();
  });

  const roundTrip = async (markdown: string) => {
    const { parserCtx, serializerCtx } = await import('@milkdown/kit/core');
    return editor.action((ctx) => {
      const doc = ctx.get(parserCtx)(markdown);
      return { out: ctx.get(serializerCtx)(doc), first: doc.firstChild?.type.name };
    });
  };

  it('keeps front matter exactly', async () => {
    const note = '---\ntitle: Plan\ntags: [a, b]\nnested:\n  - x\n---\n# Heading\n\nBody\n';
    expect(await roundTrip(note)).toEqual({ out: note, first: 'frontmatter' });
  });

  it('keeps bold and italics after it', async () => {
    // Milkdown reads each `*`/`_` marker from the source at the node's
    // offset, so the body's offsets have to be the file's.
    const note = '---\ntitle: Plan\n---\n\nSome **bold**, *italic* and __strong__ text.\n';
    expect((await roundTrip(note)).out).toBe(note);
  });

  it('keeps the blank line after it, or its absence', async () => {
    const note = '---\na: 1\n---\n\nBody\n';
    expect((await roundTrip(note)).out).toBe(note);
  });

  it('keeps empty front matter', async () => {
    expect((await roundTrip('---\n---\nBody\n')).out).toBe('---\n---\nBody\n');
  });

  it('stays first, and a second one becomes YAML', async () => {
    const { editorViewCtx, parserCtx, serializerCtx } = await import('@milkdown/kit/core');
    const out = editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      const parse = ctx.get(parserCtx);
      const doc = parse('---\na: 1\n---\nBody\n');
      view.dispatch(view.state.tr.replaceWith(0, view.state.doc.content.size, doc.content));
      // Typed above it, and pasted below it.
      const typed = view.state.schema.nodes.paragraph.create(null, view.state.schema.text('Above'));
      view.dispatch(view.state.tr.insert(0, typed));
      view.dispatch(view.state.tr.insert(view.state.doc.content.size, parse('---\nb: 2\n---\n').content));
      return ctx.get(serializerCtx)(view.state.doc);
    });
    expect(out).toBe('---\na: 1\n---\nAbove\n\nBody\n\n```yaml\nb: 2\n```\n');
  });

  it('leaves a leading thematic break that never closes', async () => {
    const { first } = await roundTrip('---\n\nHello\n');
    expect(first).toBe('hr');
  });
});
