// @vitest-environment jsdom
import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('react-pdf', () => ({ Document: () => null, Page: () => null, pdfjs: { GlobalWorkerOptions: {} } }));
vi.mock('@/lib/pdf/worker', () => ({}));
import type { Editor } from '@milkdown/kit/core';

let editor: Editor;

beforeAll(async () => {
  const { Editor, rootCtx } = await import('@milkdown/kit/core');
  const { commonmark } = await import('@milkdown/kit/preset/commonmark');
  const { gfm } = await import('@milkdown/kit/preset/gfm');
  (globalThis as { DOMMatrix?: unknown }).DOMMatrix ??= class {};
  const { history } = await import('@milkdown/kit/plugin/history');
  const { wikilink } = await import('@/lib/wikilink');
  const { editorOuterMarks, createEditorFeatures } = await import('./plugins');
  const { listener } = await import('@milkdown/kit/plugin/listener');
  const { clipboard } = await import('@milkdown/kit/plugin/clipboard');
  // Node views aren't what's under test: plain DOM stands in for React's.
  const nodeViewFactory = (() => () => ({ dom: document.createElement('div') })) as never;
  // The note editor's own list, so the keys meet everything they'd meet there.
  editor = await Editor.make()
    .config((ctx) => ctx.set(rootCtx, document.createElement('div')))
    .use(listener)
    .use(editorOuterMarks())
    .use(commonmark)
    .use(gfm)
    .use(history)
    .use(clipboard)
    .use(wikilink)
    .use(createEditorFeatures({ notePath: '/w/note.md', nodeViewFactory }))
    .create();
});

/** Loads `markdown` with the caret at `|`, presses `key` as the editor would get it, and serializes. */
async function press(markdown: string, key: string, shiftKey = false): Promise<string> {
  const { editorViewCtx, parserCtx, serializerCtx } = await import('@milkdown/kit/core');
  const { TextSelection } = await import('@milkdown/kit/prose/state');
  return editor.action((ctx) => {
    const view = ctx.get(editorViewCtx);
    const doc = ctx.get(parserCtx)(markdown);
    view.dispatch(view.state.tr.replaceWith(0, view.state.doc.content.size, doc.content));
    let at = 0;
    view.state.doc.descendants((node, pos) => {
      if (node.isText && node.text!.includes('|')) at = pos + node.text!.indexOf('|');
    });
    const tr = view.state.tr.delete(at, at + 1);
    view.dispatch(tr.setSelection(TextSelection.create(tr.doc, at)));
    const event = new KeyboardEvent('keydown', { key, shiftKey, keyCode: key === 'Backspace' ? 8 : 13 });
    view.someProp('handleKeyDown', (f) => f(view, event));
    return ctx.get(serializerCtx)(view.state.doc);
  });
}

describe('list keys, through the editor', () => {
  it('Backspace at the start of a nested item outdents it', async () => {
    expect(await press('* [ ] Eggs\n  * [ ] |Free range\n', 'Backspace')).toBe('* [ ] Eggs\n* [ ] Free range\n');
  });

  it("takes iOS's shifted Backspace at the start of a line as Backspace", async () => {
    expect(await press('* [ ] Eggs\n  * [ ] |Free range\n', 'Backspace', true)).toBe('* [ ] Eggs\n* [ ] Free range\n');
  });

  it("joins a shifted Backspace's line to the one above, as Backspace does", async () => {
    expect(await press('* Eggs\n\n|Free range\n', 'Backspace', true)).toBe('* EggsFree range\n');
  });

  it('Backspace at the start of a top-level item makes it a paragraph', async () => {
    expect(await press('* Milk\n* |Eggs\n', 'Backspace')).toBe('* Milk\n\nEggs\n');
  });

  it("Enter in a task starts an unchecked one", async () => {
    expect(await press('* [x] Milk|\n', 'Enter')).toBe('* [x] Milk\n* [ ] <br />\n');
  });
});
