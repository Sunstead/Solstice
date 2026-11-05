/**
 * A headless note editor for tests: the note editor's own plugin list, with
 * plain DOM in place of React's node views. Use from a jsdom test.
 *
 *   const ed = await createTestEditor();
 *   ed.load('* a\n* |b\n');
 *   ed.press('Backspace');
 *   expect(ed.show()).toBe('* a\n\n|b\n');
 *
 * `|` marks the caret (two of them, a selection). `show()` writes it back the
 * same way, and a selected node as `[type]`.
 *
 * Only what the editor does in JS runs here: a key nothing in the keymaps
 * takes (plain arrows, Backspace mid-word) does nothing, as the browser isn't
 * there to do it.
 */
import { vi } from 'vitest';
import type { Editor } from '@milkdown/kit/core';
import type { Command } from '@milkdown/kit/prose/state';
import type { EditorView } from '@milkdown/kit/prose/view';

const CARET = '|';
// Unescaped by remark, unlike `|` and `[`.
const SENTINEL = '‸';
const OPEN = '⟦';
const CLOSE = '⟧';
const SOURCE_MARKS = ['wikilink', 'math_inline', 'callout_marker'];

export interface TestEditor {
  view: EditorView;
  /** Loads `markdown`, the caret at `|`. */
  load(markdown: string): void;
  /** A keydown as the editor gets it. Returns whether something took it. */
  press(key: string, mods?: { shift?: boolean; alt?: boolean; mod?: boolean }): boolean;
  /** A `beforeinput`, as the system's keyboard sends it. Returns whether it was cancelled. */
  beforeInput(inputType: string): boolean;
  /** Moves the caret, as a click would, to `offset` in the caret's textblock. */
  select(offset: number): void;
  /** Runs a command on the editor. Returns whether it applied. */
  run(command: Command): boolean;
  /** The note as markdown, `|` at the caret or `[type]` for a selected node. */
  show(): string;
}

export async function createTestEditor(): Promise<TestEditor> {
  vi.doMock('react-pdf', () => ({ Document: () => null, Page: () => null, pdfjs: { GlobalWorkerOptions: {} } }));
  vi.doMock('@/lib/pdf/worker', () => ({}));
  (globalThis as { DOMMatrix?: unknown }).DOMMatrix ??= class {};

  const { Editor, rootCtx, editorViewCtx, parserCtx, serializerCtx } = await import('@milkdown/kit/core');
  const { commonmark } = await import('@milkdown/kit/preset/commonmark');
  const { gfm } = await import('@milkdown/kit/preset/gfm');
  const { history } = await import('@milkdown/kit/plugin/history');
  const { listener } = await import('@milkdown/kit/plugin/listener');
  const { clipboard } = await import('@milkdown/kit/plugin/clipboard');
  const { EditorState, NodeSelection, TextSelection } = await import('@milkdown/kit/prose/state');
  const { wikilink } = await import('@/lib/wikilink');
  const { editorOuterMarks, createEditorFeatures } = await import('./plugins');
  const { configureListKeys } = await import('./list-keymap');

  // Node views aren't what's under test: plain DOM stands in for React's.
  const nodeViewFactory = (() => () => ({ dom: document.createElement('div') })) as never;
  const root = document.createElement('div');
  document.body.append(root);
  const editor: Editor = await Editor.make()
    .config((ctx) => {
      ctx.set(rootCtx, root);
      configureListKeys(ctx);
    })
    .use(listener)
    .use(editorOuterMarks())
    .use(commonmark)
    .use(gfm)
    .use(history)
    .use(clipboard)
    .use(wikilink)
    .use(createEditorFeatures({ notePath: '/w/note.md', nodeViewFactory }))
    .create();

  const view = editor.action((ctx) => ctx.get(editorViewCtx));
  const parse = editor.action((ctx) => ctx.get(parserCtx));
  const serialize = editor.action((ctx) => ctx.get(serializerCtx));

  return {
    view,

    load(markdown) {
      const marked = parse(markdown);
      const at: number[] = [];
      marked.descendants((node, pos) => {
        if (node.isText) for (let i = node.text!.indexOf(CARET); i !== -1; i = node.text!.indexOf(CARET, i + 1)) at.push(pos + i);
        // Inside a code block the caret is literal text too.
        return true;
      });
      if (at.length === 0) throw new Error(`no caret in ${JSON.stringify(markdown)}`);
      const scratch = EditorState.create({ doc: marked });
      const tr = scratch.tr;
      for (const pos of [...at].reverse()) tr.delete(pos, pos + 1);
      const [anchor, head = anchor] = at.map((pos, i) => pos - i);
      view.updateState(
        EditorState.create({
          doc: tr.doc,
          plugins: view.state.plugins,
          selection: TextSelection.create(tr.doc, anchor, head),
        }),
      );
    },

    press(key, mods = {}) {
      const event = new KeyboardEvent('keydown', {
        key,
        shiftKey: mods.shift ?? false,
        altKey: mods.alt ?? false,
        ctrlKey: mods.mod ?? false,
        cancelable: true,
      });
      return view.someProp('handleKeyDown', (f) => f(view, event)) ?? false;
    },

    beforeInput(inputType) {
      const event = new InputEvent('beforeinput', { inputType, cancelable: true });
      view.someProp('handleDOMEvents', (handlers) => handlers.beforeinput?.(view, event));
      return event.defaultPrevented;
    },

    select(offset) {
      const start = view.state.selection.$head.start();
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, start + offset)));
    },

    run(command) {
      return command(view.state, view.dispatch);
    },

    show() {
      const { selection, schema } = view.state;
      const tr = view.state.tr;
      if (selection instanceof NodeSelection) {
        const label = `${OPEN}${selection.node.type.name}${CLOSE}`;
        const stand = selection.node.isInline
          ? schema.text(label)
          : schema.nodes.paragraph.create(null, schema.text(label));
        tr.replaceWith(selection.from, selection.to, stand);
      } else {
        // Source marks dropped, so a caret inside a link's source doesn't
        // split it into runs that no longer read as a link.
        const at = [selection.head, selection.anchor].filter((pos, i, all) => all.indexOf(pos) === i).sort((a, b) => b - a);
        for (const pos of at) {
          // Marks on both sides, so the caret doesn't split a run in two.
          const $at = tr.doc.resolve(pos);
          const after = $at.nodeAfter?.marks ?? [];
          tr.insert(pos, schema.text(SENTINEL, ($at.nodeBefore?.marks ?? []).filter((mark) => mark.isInSet(after))));
          const $pos = tr.doc.resolve(pos);
          const start = $pos.start();
          for (const name of SOURCE_MARKS) {
            const type = schema.marks[name];
            if (type) tr.removeMark(start, start + $pos.parent.content.size, type);
          }
        }
      }
      return serialize(tr.doc)
        .replace(/\\([[\]$!|_])/g, '$1')
        .split(SENTINEL).join(CARET)
        .split(OPEN).join('[')
        .split(CLOSE).join(']');
    },
  };
}
