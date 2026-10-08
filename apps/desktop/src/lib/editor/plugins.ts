import type { MilkdownPlugin } from '@milkdown/kit/ctx';
import { $view } from '@milkdown/kit/utils';
import type { useNodeViewFactory } from '@prosemirror-adapter/react';

import { codeBlockSchema } from '@milkdown/kit/preset/commonmark';

import { EditorView as CodeMirrorView } from '@codemirror/view';

import { CodeBlockView } from '@/components/editor/code-block-view';
import { syncFromDoc } from '@/lib/codeblock/bridge';
import { codeBlockKeymap } from '@/lib/codeblock/keymap';
import { createEmbedView } from '@/components/editor/embed-view';
import { ImageView } from '@/components/editor/image-view';
import {
  insertWikiEmbedInputRule,
  wikiEmbedSchema,
} from '@/lib/embed/schema';
import { MathBlockView } from '@/components/editor/math-block-view';
import { math, mathBlockSchema } from '@/lib/math';
import { autoPair } from '@/lib/autopair';
import { callout } from '@/lib/callout';
import { highlight, highlightSchema } from '@/lib/highlight';
import { commentDecorations } from '@/lib/comment';
import { blockIdDecorations } from '@/lib/blockid';
import { frontmatter, frontmatterView } from '@/lib/frontmatter';
import { footnote } from '@/lib/footnote';
import { table } from '@/lib/table';
import { taskList } from '@/lib/tasklist';
import { listEditing } from './list-keymap';
import { link } from '@/lib/link';
import { imageWithSize, insertImageWithSizeInputRule } from '@/lib/image/schema';
import { attachmentPasteDrop } from './paste-drop';
import { slashMenu } from '@/lib/slash';

type NodeViewFactory = ReturnType<typeof useNodeViewFactory>;

export interface EditorFeatureOptions {
  /** Absolute path of the note, for resolving and writing relative links. */
  notePath: string;
  nodeViewFactory: NodeViewFactory;
}

/**
 * Marks that have to rank above commonmark's, so `.use()` before it. A mark's
 * rank decides which of two nests outside the other when they're written
 * back: ranked after `strong`, `==**a** b==` would come back as
 * `**==a==** ==b==`.
 */
export function editorOuterMarks(): MilkdownPlugin[] {
  return [highlightSchema].flat();
}

/**
 * What the document *is*: every node and mark this app adds to commonmark,
 * with the rules that parse and serialize them. No React, no node views, no
 * path.
 *
 * Split out from `createEditorFeatures` so a headless editor can be built from
 * the same list -- see `static-markdown.ts`, which renders a canvas card's
 * markdown with no editor attached to anything. Sharing the list is what keeps
 * a card and a note definitionally in step: a feature added here appears in
 * both, and there is no second manifest to forget.
 */
export function editorSchemaPlugins(): MilkdownPlugin[] {
  return [
    frontmatter,

    imageWithSize,
    insertImageWithSizeInputRule,

    wikiEmbedSchema,
    insertWikiEmbedInputRule,

    math,

    link,
    highlight,
    commentDecorations,
    blockIdDecorations,
    callout,
    taskList,
    listEditing,
    table,
    footnote,
  ].flat();
}

/**
 * Every Solstice-specific editor feature, collected in one list.
 *
 * Kept out of `milkdown-editor.tsx` deliberately: adding a feature is an edit
 * here rather than another link in an ever-growing `.use()` chain, and that
 * file already carries the autosave, external-reload and command-routing
 * machinery without also being a plugin manifest.
 *
 * Order matters. Schema overrides must come after `.use(commonmark)` so they
 * replace the preset's node of the same id.
 */
export function createEditorFeatures({
  notePath,
  nodeViewFactory,
}: EditorFeatureOptions): MilkdownPlugin[] {
  return [
    ...editorSchemaPlugins(),

    frontmatterView,

    $view(imageWithSize.node, () => nodeViewFactory({ component: ImageView })),

    // The view is built inside the factory so it closes over the editor's own
    // ctx, which transclusion needs for the parser and the schema.
    $view(wikiEmbedSchema.node, (ctx) =>
      nodeViewFactory({ component: createEmbedView(ctx) }),
    ),

    codeBlockKeymap,
    // CodeMirror owns everything inside a code block: `stopEvent` keeps
    // ProseMirror's keymap and input rules out, and `ignoreMutation` stops it
    // trying to reconcile DOM it did not write -- including selection changes,
    // which it consults `ignoreMutation` for as well.
    $view(codeBlockSchema.node, () =>
      nodeViewFactory({
        component: CodeBlockView,
        stopEvent: () => true,
        ignoreMutation: () => true,
        /**
         * Hands a selection landing inside the block over to CodeMirror.
         *
         * Without this ProseMirror places the caret itself, and since the node
         * view exposes no `contentDOM` it has nowhere sensible to put it --
         * the browser selection ends up on the node view's root and
         * CodeMirror's caret is lost. `this` is the node view, because
         * ProseMirror calls the hook as `spec.setSelection(...)`; the instance
         * is found from its DOM rather than captured, since this hook is
         * registered once for every code block rather than per block.
         */
        setSelection(this: { dom: HTMLElement }, anchor: number, head: number) {
          const cm = CodeMirrorView.findFromDOM(this.dom);
          if (!cm) return;

          const limit = cm.state.doc.length;
          if (anchor > limit || head > limit) return;

          syncFromDoc(cm, () => {
            cm.focus();
            cm.dispatch({ selection: { anchor, head } });
          });
        },
      }),
    ),

    // Events inside the formula's own controls belong to the node view, not
    // to the document: without this ProseMirror also handles what is typed
    // into the source box, and a keystroke landing on the selected node
    // replaces the whole formula.
    $view(mathBlockSchema.node, () =>
      nodeViewFactory({
        component: MathBlockView,
        stopEvent: (event) => {
          const target = event.target as HTMLElement | null;
          return Boolean(
            target?.closest?.(
              '.solstice-math-block-source, .solstice-math-block-render',
            ),
          );
        },
      }),
    ),

    // Last, so every preset input rule -- emphasis, headings, lists -- is
    // tried before the generic pairs. Input rules inside a `code` textblock
    // never run at all, so code blocks need no special case here.
    autoPair,

    attachmentPasteDrop(notePath),

    slashMenu,
  ].flat();
}
