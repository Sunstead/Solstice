import { useEffect } from 'react';
import {
  defaultValueCtx,
  Editor,
  editorViewCtx,
  rootCtx,
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
 * A real editor, mounted for the one card being edited.
 *
 * Never more than one at a time. A board of two hundred cards each holding a
 * live ProseMirror would need viewport virtualization just to open, and every
 * one of those instances would bring its own undo history and command surface
 * for a card nobody is looking at. Read mode renders statically instead, from
 * the same schema -- so entering and leaving edit mode changes what the card
 * can *do*, not what it looks like.
 *
 * No autosaver of its own: a text card's content lives in the `.canvas` JSON,
 * and the board's autosaver is the only writer on that path. Built from
 * `editorSchemaPlugins()` rather than `createEditorFeatures()`, which means no
 * React node views -- a card editor gets the schema's own rendering for code
 * blocks and images rather than CodeMirror and resolved asset URLs. That is the
 * price of not mounting a full editor per card; read mode, which is what a card
 * shows almost all of the time, resolves them properly.
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
            // Straight into the document, per keystroke, so the board's
            // autosaver runs and closing the tab mid-sentence loses nothing.
            // The coalesce key is what stops a sentence becoming two hundred
            // undo entries: consecutive edits to the same card replace the top
            // entry instead of stacking, and any other action closes the run.
            state.commit(setNodeText(state.doc, node.id, markdown), {
              coalesceKey: `text:${node.id}`,
            });
          });
        })
        .use(listener)
        .use(commonmark)
        .use(gfm)
        // Its own undo stack while the caret is in the card, so Cmd+Z steps
        // back through typing rather than through the board's gestures.
        .use(history)
        .use(clipboard)
        .use(wikilink)
        .use(editorSchemaPlugins()),
    // Built once. `node.text` is only read for the initial value; letting it
    // rebuild on every keystroke would destroy the caret.
    [node.id],
  );

  // Focus on mount, so double-clicking a card puts the caret in it rather than
  // requiring a second click.
  useEffect(() => {
    if (loading) return;
    const editor = getEditor();
    if (!editor) return;

    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      view.focus();
    });
  }, [loading, getEditor]);

  return <Milkdown />;
}

export function CanvasTextEditor({ node }: { node: TextNode }) {
  return (
    <MilkdownProvider>
      <TextEditorCore node={node} />
    </MilkdownProvider>
  );
}
