// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from 'vitest';
import type { Editor } from '@milkdown/kit/core';
import type { Command } from '@milkdown/kit/prose/state';
import type { Ctx } from '@milkdown/kit/ctx';

import type { ListKind } from './list-commands';

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

/**
 * Loads `markdown` with the caret at `|` (or the selection between two of
 * them), runs the command, and serializes. Returns null if it didn't apply.
 */
async function run(markdown: string, command: (ctx: Ctx) => Command): Promise<string | null> {
  const { editorViewCtx, parserCtx, serializerCtx } = await import('@milkdown/kit/core');
  const { TextSelection } = await import('@milkdown/kit/prose/state');
  return editor.action((ctx) => {
    const view = ctx.get(editorViewCtx);
    const doc = ctx.get(parserCtx)(markdown);
    view.dispatch(view.state.tr.replaceWith(0, view.state.doc.content.size, doc.content));
    const marks: number[] = [];
    view.state.doc.descendants((node, pos) => {
      if (!node.isText) return;
      for (let i = node.text!.indexOf('|'); i !== -1; i = node.text!.indexOf('|', i + 1)) marks.push(pos + i);
    });
    let tr = view.state.tr;
    for (const at of [...marks].reverse()) tr = tr.delete(at, at + 1);
    const [from, to = from] = marks.map((at, i) => at - i);
    view.dispatch(tr.setSelection(TextSelection.create(tr.doc, from, to)));
    if (!command(ctx)(view.state, view.dispatch)) return null;
    return ctx.get(serializerCtx)(view.state.doc);
  });
}

describe('toggleList', async () => {
  const { toggleList } = await import('./list-commands');
  const { bulletListSchema, listItemSchema, orderedListSchema } = await import('@milkdown/kit/preset/commonmark');
  const toggle = (markdown: string, kind: ListKind) =>
    run(markdown, (ctx) =>
      toggleList(kind, {
        listItem: listItemSchema.type(ctx),
        bulletList: bulletListSchema.type(ctx),
        orderedList: orderedListSchema.type(ctx),
      }),
    );

  it('makes a paragraph a task', async () => {
    expect(await toggle('Milk|\n', 'task')).toBe('* [ ] Milk\n');
  });

  it('makes each selected paragraph an item', async () => {
    expect(await toggle('|Milk\n\nEggs|\n', 'bullet')).toBe('* Milk\n* Eggs\n');
    expect(await toggle('|Milk\n\nEggs|\n', 'task')).toBe('* [ ] Milk\n* [ ] Eggs\n');
  });

  it('turns a bullet into a task and back, item by item', async () => {
    expect(await toggle('* Milk\n* Eggs|\n', 'task')).toBe('* Milk\n* [ ] Eggs\n');
    expect(await toggle('* [ ] Milk|\n* [ ] Eggs\n', 'bullet')).toBe('* Milk\n* [ ] Eggs\n');
  });

  it('reaches an item nested in another', async () => {
    expect(await toggle('* Milk\n  * Eggs|\n', 'task')).toBe('* Milk\n  * [ ] Eggs\n');
  });

  it('takes the items out of a list of the same kind', async () => {
    expect(await toggle('* Milk|\n', 'bullet')).toBe('Milk\n');
    expect(await toggle('* [ ] Milk|\n', 'task')).toBe('Milk\n');
    expect(await toggle('1. Milk|\n', 'ordered')).toBe('Milk\n');
    expect(await toggle('* Milk\n  * Eggs|\n', 'bullet')).toBe('* Milk\n\nEggs\n');
  });

  it('switches between numbered and not', async () => {
    expect(await toggle('* Milk|\n* Eggs\n', 'ordered')).toBe('1. Milk\n2. Eggs\n');
    expect(await toggle('1. Milk|\n2. Eggs\n', 'bullet')).toBe('* Milk\n* Eggs\n');
    expect(await toggle('1. Milk|\n2. Eggs\n', 'task')).toBe('* [ ] Milk\n* [ ] Eggs\n');
    expect(await toggle('* [x] Milk|\n', 'ordered')).toBe('1. Milk\n');
  });
});

describe('listEnter', async () => {
  const { listEnter } = await import('./list-commands');
  const { listItemSchema } = await import('@milkdown/kit/preset/commonmark');
  const enter = (markdown: string) => run(markdown, (ctx) => listEnter(listItemSchema.type(ctx)));

  it("starts a task's next item unchecked", async () => {
    expect(await enter('* [x] Milk|\n')).toBe('* [x] Milk\n* [ ] <br />\n');
  });

  it('outdents an empty nested item, keeping it a task', async () => {
    expect(await enter('* Milk\n  * [ ] |\n')).toBe('* Milk\n* [ ] <br />\n');
    expect(await enter('* Milk\n  * |\n')).toBe('* Milk\n* <br />\n');
  });

  it("leaves plain items and top-level empties to the preset", async () => {
    expect(await enter('* Milk|\n')).toBeNull();
    expect(await enter('* Milk\n* |\n')).toBeNull();
  });
});

describe('listBackspace', async () => {
  const { listBackspace } = await import('./list-commands');
  const { listItemSchema } = await import('@milkdown/kit/preset/commonmark');
  const backspace = (markdown: string) => run(markdown, (ctx) => listBackspace(listItemSchema.type(ctx)));

  it('turns a top-level item into a paragraph, splitting the list', async () => {
    expect(await backspace('* Milk\n* |Eggs\n* Bread\n')).toBe('* Milk\n\nEggs\n\n* Bread\n');
  });

  it('outdents a nested item', async () => {
    expect(await backspace('* Milk\n  * |Eggs\n')).toBe('* Milk\n* Eggs\n');
  });

  it('only acts at the start of an item', async () => {
    expect(await backspace('* Mi|lk\n')).toBeNull();
    expect(await backspace('Milk|\n')).toBeNull();
  });
});
