// @vitest-environment jsdom
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { Editor } from '@milkdown/kit/core';

vi.mock('react-pdf', () => ({ Document: () => null, Page: () => null, pdfjs: { GlobalWorkerOptions: {} } }));
vi.mock('@/lib/pdf/worker', () => ({}));

describe('==highlight==', () => {
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

  const parse = async (markdown: string) => {
    const { parserCtx, serializerCtx } = await import('@milkdown/kit/core');
    return editor.action((ctx) => {
      const doc = ctx.get(parserCtx)(markdown);
      const marked: string[] = [];
      doc.descendants((node) => {
        if (node.isText && node.marks.some((m) => m.type.name === 'highlight')) marked.push(node.text ?? '');
      });
      return { out: ctx.get(serializerCtx)(doc), marked };
    });
  };

  it('marks a highlight and writes it back', async () => {
    expect(await parse('Some ==bright== text.\n')).toEqual({ out: 'Some ==bright== text.\n', marked: ['bright'] });
  });

  it('keeps formatting inside it', async () => {
    const { out, marked } = await parse('==**bold** and *more*==\n');
    expect(out).toBe('==**bold** and *more*==\n');
    expect(marked).toEqual(['bold', ' and ', 'more']);
  });

  it('leaves equals signs that are not a highlight', async () => {
    for (const text of ['a == b == c\n', 'x === y\n', 'only ==one\n', '`==code==` here\n']) {
      expect(await parse(text)).toEqual({ out: text, marked: [] });
    }
  });

  it('pairs two highlights in one line', async () => {
    expect((await parse('==a== and ==b==\n')).marked).toEqual(['a', 'b']);
  });
});
