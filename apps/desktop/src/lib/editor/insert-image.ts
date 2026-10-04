import { open } from '@/lib/backend/shell';
import { editorViewCtx } from '@milkdown/kit/core';
import type { Ctx } from '@milkdown/kit/ctx';

import { imageWithSize } from '@/lib/image/schema';
import { importAttachment } from './attachments';

/** Kept in step with the types `resolveAsset` can actually display. */
const IMAGE_EXTENSIONS = [
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'avif',
  'bmp',
  'svg',
];

/**
 * Picks image files, copies them into the workspace, and inserts them at the
 * caret.
 *
 * Takes a `runAction` rather than an editor so ownership of the Milkdown
 * context stays with the caller -- this module never holds an editor instance.
 */
export async function insertImagesFromDialog(
  runAction: (fn: (ctx: Ctx) => void) => void,
  notePath: string,
) {
  const picked = await open({
    multiple: true,
    filters: [{ name: 'Images', extensions: IMAGE_EXTENSIONS }],
  });

  if (!picked) return;

  for (const sourcePath of Array.isArray(picked) ? picked : [picked]) {
    const saved = await importAttachment(sourcePath, notePath);
    if (!saved) continue;

    runAction((ctx) => {
      const view = ctx.get(editorViewCtx);
      const node = imageWithSize.type(ctx).create({ src: saved.src });
      view.dispatch(view.state.tr.replaceSelectionWith(node).scrollIntoView());
    });
  }
}
