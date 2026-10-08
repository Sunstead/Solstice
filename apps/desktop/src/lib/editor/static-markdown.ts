import { Editor, editorViewCtx, parserCtx, rootCtx } from '@milkdown/kit/core';
import { commonmark } from '@milkdown/kit/preset/commonmark';
import { gfm } from '@milkdown/kit/preset/gfm';
import { DOMSerializer } from '@milkdown/kit/prose/model';

import { resolveAsset } from '@/lib/image/resolve';
import { useWikilinkIndex } from '@/lib/stores/wikilink-index';
import { wikilink } from '@/lib/wikilink';
import { parseWikilinkTarget, wikilinkLabel } from '@/lib/wikilink/target';
import { stripComments } from '@/lib/comment';
import { editorOuterMarks, editorSchemaPlugins } from './plugins';

/**
 * Markdown rendered to DOM, with no editor attached to anything.
 *
 * `embed-view.tsx` can get a parser and a schema from the note editor it is
 * rendered inside. A canvas tab has no such editor, but its cards have to
 * render markdown that looks exactly like a note -- wikilinks, callouts, math,
 * task lists and all -- so it needs its own.
 *
 * One detached instance for the whole app, not one per surface. A second
 * instance would be a second `Schema`, and two schemas mean a document parsed
 * on one surface cannot be handed to another. It is also the only arrangement
 * that keeps the canvas and the note editor definitionally in step: both build
 * from `editorSchemaPlugins()`.
 *
 * The root element is created and never appended, so nothing lays out, nothing
 * paints, and no node view ever mounts. `DOMSerializer` reads the schema's own
 * `toDOM` specs, which is exactly what a read-only preview should show.
 */

let instance: Promise<Editor> | null = null;

function getRenderer(): Promise<Editor> {
  if (instance) return instance;

  instance = Editor.make()
    .config((ctx) => {
      // Detached on purpose. Milkdown insists on a root; it never has to be in
      // the document for the parser and the schema to exist.
      ctx.set(rootCtx, document.createElement('div'));
    })
    .use(editorOuterMarks())
    .use(commonmark)
    .use(gfm)
    .use(wikilink)
    .use(editorSchemaPlugins())
    .create()
    .catch((error) => {
      // A failed create must not poison every later call with a rejected
      // promise that can never resolve.
      instance = null;
      throw error;
    });

  return instance;
}

/**
 * Warms the renderer up.
 *
 * `Editor.create()` is async, so the first card would otherwise show its raw
 * source for a frame or two. Called when a canvas tab mounts, which is early
 * enough that nothing ever sees it.
 */
export function warmStaticRenderer(): void {
  void getRenderer().catch((error) =>
    console.error('[static-markdown] failed to start:', error),
  );
}

/**
 * Rewrites the links inside statically rendered markdown.
 *
 * The content was written relative to `sourcePath` -- the note it was
 * transcluded from, or the canvas file a card lives in -- rather than to
 * whatever is displaying it, so relative assets have to be resolved against
 * that, not against the surface.
 *
 * Shared with `embed-view.tsx` rather than duplicated: both are the same
 * problem, and two copies would drift the first time one of them learned about
 * a new kind of link.
 */
export function rewriteStaticFragment(
  fragment: ParentNode,
  sourcePath: string,
  workspaceRoot: string | null,
): void {
  const index = useWikilinkIndex.getState();

  for (const image of Array.from(fragment.querySelectorAll('img[src]'))) {
    const asset = resolveAsset(
      image.getAttribute('src') ?? '',
      { notePath: sourcePath, workspaceRoot },
      index,
    );

    if (asset.status === 'unresolved') image.removeAttribute('src');
    else image.setAttribute('src', asset.url);
  }

  // Wikilinks serialize as their literal `[[target]]` source. In a preview
  // there is nothing to edit, so show what a collapsed link would show.
  for (const link of Array.from(fragment.querySelectorAll('[data-wikilink]'))) {
    const raw = link.textContent ?? '';
    const target = raw.slice(2, -2);
    link.textContent = wikilinkLabel(parseWikilinkTarget(target).path);
    link.classList.add('wikilink', 'wikilink-resolved');
  }
}

/**
 * @param sourcePath What relative links inside `markdown` resolve against. For
 *   a canvas card that is the `.canvas` file's own path, matching how a board
 *   authored elsewhere expects its links to work.
 * @returns null when the renderer could not be created; the caller should fall
 *   back to showing the source.
 */
export async function renderMarkdownFragment(
  markdown: string,
  context: { sourcePath: string; workspaceRoot: string | null },
): Promise<DocumentFragment | null> {
  let editor: Editor;
  try {
    editor = await getRenderer();
  } catch {
    return null;
  }

  let rendered: DocumentFragment | null = null;

  editor.action((ctx) => {
    const doc = ctx.get(parserCtx)(stripComments(markdown));
    if (!doc) return;

    const schema = ctx.get(editorViewCtx).state.schema;
    // `serializeFragment` is typed as returning the target it was given, which
    // is a `DocumentFragment` when -- as here -- none is passed.
    const fragment = DOMSerializer.fromSchema(schema).serializeFragment(
      doc.content,
    ) as DocumentFragment;

    rewriteStaticFragment(fragment, context.sourcePath, context.workspaceRoot);
    rendered = fragment;
  });

  return rendered;
}
