import type { MilkdownPlugin } from '@milkdown/kit/ctx';
import { $view } from '@milkdown/kit/utils';
import type { useNodeViewFactory } from '@prosemirror-adapter/react';

import { codeBlockSchema } from '@milkdown/kit/preset/commonmark';

import { CodeBlockView } from '@/components/editor/code-block-view';
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
import { footnote } from '@/lib/footnote';
import { table } from '@/lib/table';
import { taskList } from '@/lib/tasklist';
import { link } from '@/lib/link';
import { imageWithSize, insertImageWithSizeInputRule } from '@/lib/image/schema';
import { attachmentPasteDrop } from './paste-drop';

type NodeViewFactory = ReturnType<typeof useNodeViewFactory>;

export interface EditorFeatureOptions {
  /** Absolute path of the note, for resolving and writing relative links. */
  notePath: string;
  nodeViewFactory: NodeViewFactory;
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
    imageWithSize,
    insertImageWithSizeInputRule,
    $view(imageWithSize.node, () => nodeViewFactory({ component: ImageView })),

    wikiEmbedSchema,
    insertWikiEmbedInputRule,
    // The view is built inside the factory so it closes over the editor's own
    // ctx, which transclusion needs for the parser and the schema.
    $view(wikiEmbedSchema.node, (ctx) =>
      nodeViewFactory({ component: createEmbedView(ctx) }),
    ),

    // CodeMirror owns everything inside a code block: `stopEvent` keeps
    // ProseMirror's keymap and input rules out, and `ignoreMutation` stops it
    // trying to reconcile DOM it did not write.
    $view(codeBlockSchema.node, () =>
      nodeViewFactory({
        component: CodeBlockView,
        stopEvent: () => true,
        ignoreMutation: () => true,
      }),
    ),

    math,
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

    link,
    callout,
    taskList,
    table,
    footnote,
    // Last, so every preset input rule -- emphasis, headings, lists -- is
    // tried before the generic pairs. Input rules inside a `code` textblock
    // never run at all, so code blocks need no special case here.
    autoPair,

    attachmentPasteDrop(notePath),
  ].flat();
}
