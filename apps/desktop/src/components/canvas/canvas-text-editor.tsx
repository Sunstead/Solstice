import { useEffect } from 'react';
import {
  defaultValueCtx,
  Editor,
  editorViewCtx,
  rootCtx,
  serializerCtx,
} from '@milkdown/kit/core';
import { clipboard } from '@milkdown/kit/plugin/clipboard';
import { history } from '@milkdown/kit/plugin/history';
import { listener, listenerCtx } from '@milkdown/kit/plugin/listener';
import { commonmark } from '@milkdown/kit/preset/commonmark';
import { gfm } from '@milkdown/kit/preset/gfm';
import { Milkdown, MilkdownProvider, useEditor, useInstance } from '@milkdown/react';

import { setNodeText } from '@/lib/canvas/doc';
import type { TextNode } from '@/lib/canvas/types';
import { useCanvasStoreApi } from '@/lib/canvas/use-canvas-store';
import { editorSchemaPlugins } from '@/lib/editor/plugins';
import { wikilink } from '@/lib/wikilink';

/**
 * A real editor, mounted for the one card being edited and never more than
 * one: two hundred live ProseMirrors would each bring their own undo history
 * and command surface for a card nobody is looking at. Read mode renders
 * statically from the same schema, so entering edit mode changes what a card
 * can do rather than what it looks like.
 *
 * No autosaver of its own -- a text card's content lives in the `.canvas`
 * JSON, and the board's autosaver is the only writer. Built from
 * `editorSchemaPlugins()` rather than `createEditorFeatures()`, so there are
 * no React node views: code blocks and images get the schema's own rendering
 * here, and read mode resolves them properly.
 */
function TextEditorCore({ node }: { node: TextNode }) {
  const store = useCanvasStoreApi();
  const [loading, getEditor] = useInstance();

  useEditor(
    (root) =>
      Editor.make()
        .config((ctx) => {
          ctx.set(rootCtx, root);
          ctx.set(defaultValueCtx, node.text);

          ctx.get(listenerCtx).markdownUpdated((_ctx, markdown) => {
            const state = store.getState();
            // Per keystroke, so the board's autosaver runs and closing the
            // tab mid-sentence loses nothing. The coalesce key stops a
            // sentence becoming two hundred undo entries.
            state.commit(setNodeText(state.doc, node.id, markdown), {
              coalesceKey: `text:${node.id}`,
            });
          });
        })
        .use(listener)
        .use(commonmark)
        .use(gfm)
        // Its own undo stack, so Cmd+Z in a card steps back through typing
        // rather than through the board's gestures.
        .use(history)
        .use(clipboard)
        .use(wikilink)
        .use(editorSchemaPlugins()),
    // Built once: `node.text` is only the initial value, and rebuilding on
    // every keystroke would destroy the caret.
    [node.id],
  );

  // So double-clicking a card puts the caret in it.
  useEffect(() => {
    if (loading) return;
    const editor = getEditor();
    if (!editor) return;

    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      view.focus();
    });
  }, [loading, getEditor]);

  // See `registerCardFlush`: reads the live ProseMirror document rather than
  // waiting on `markdownUpdated`'s debounce, which would still be pending when
  // the card unmounts. Same coalesce key as the listener above -- not a
  // separate edit, just a guarantee the last one lands.
  useEffect(() => {
    if (loading) return;
    const editor = getEditor();
    if (!editor) return;

    const flush = () => {
      const markdown = editor.action((ctx) =>
        ctx.get(serializerCtx)(ctx.get(editorViewCtx).state.doc),
      );
      const state = store.getState();
      state.commit(setNodeText(state.doc, node.id, markdown), {
        coalesceKey: `text:${node.id}`,
      });
    };

    return store.getState().registerCardFlush(node.id, flush);
  }, [loading, getEditor, store, node.id]);

  return <Milkdown />;
}

export function CanvasTextEditor({ node }: { node: TextNode }) {
  return (
    <MilkdownProvider>
      <TextEditorCore node={node} />
    </MilkdownProvider>
  );
}
