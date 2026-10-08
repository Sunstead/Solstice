// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from 'vitest';
import type { Editor } from '@milkdown/kit/core';

describe('toggleTaskList', () => {
  let editor: Editor;

  beforeAll(async () => {
    const { Editor, rootCtx } = await import('@milkdown/kit/core');
    const { commonmark } = await import('@milkdown/kit/preset/commonmark');
    const { gfm } = await import('@milkdown/kit/preset/gfm');
    editor = await Editor.make()
      .config((ctx) => ctx.set(rootCtx, document.createElement('div')))
      .use(commonmark)
      .use(gfm)
      .create();
  });

  /** Loads `markdown`, puts the caret at the end of `at`, toggles, and serializes. */
  const toggle = async (markdown: string, at: string) => {
    const { editorViewCtx, parserCtx, serializerCtx } = await import('@milkdown/kit/core');
    const { TextSelection } = await import('@milkdown/kit/prose/state');
    const { bulletListSchema, listItemSchema } = await import('@milkdown/kit/preset/commonmark');
    const { toggleTaskList } = await import('./list-commands');
    return editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      const doc = ctx.get(parserCtx)(markdown);
      view.dispatch(view.state.tr.replaceWith(0, view.state.doc.content.size, doc.content));
      let pos = 0;
      view.state.doc.descendants((node, p) => {
        if (node.isText && node.text === at) pos = p + node.nodeSize;
      });
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos)));
      toggleTaskList(listItemSchema.type(ctx), bulletListSchema.type(ctx))(view.state, view.dispatch);
      return ctx.get(serializerCtx)(view.state.doc);
    });
  };

  it('makes a paragraph a task', async () => {
    expect(await toggle('Milk\n', 'Milk')).toBe('* [ ] Milk\n');
  });

  it('makes a list item a task, and back', async () => {
    expect(await toggle('* Milk\n* Eggs\n', 'Eggs')).toBe('* Milk\n* [ ] Eggs\n');
    expect(await toggle('* [ ] Milk\n', 'Milk')).toBe('* Milk\n');
  });

  it('reaches an item nested in another', async () => {
    expect(await toggle('* Milk\n  * Eggs\n', 'Eggs')).toBe('* Milk\n  * [ ] Eggs\n');
  });
});
