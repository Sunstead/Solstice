import { $prose } from '@milkdown/kit/utils';
import { Plugin, PluginKey, TextSelection } from '@milkdown/kit/prose/state';
import type { EditorView } from '@milkdown/kit/prose/view';
import type { Ctx } from '@milkdown/kit/ctx';

import { imageWithSize } from '@/lib/image/schema';
import { saveAttachment } from './attachments';

const attachmentDropKey = new PluginKey('solstice-attachment-drop');

function imageFiles(transfer: DataTransfer | null): File[] {
  if (!transfer) return [];

  return Array.from(transfer.files).filter((file) =>
    file.type.startsWith('image/'),
  );
}

/**
 * Saves each file, then drops an image node at the selection. Sequential
 * rather than parallel so several files pasted at once keep their order, and
 * driven through the selection so each insert lands after the previous one
 * without any position arithmetic.
 */
async function insertImages(
  ctx: Ctx,
  view: EditorView,
  files: File[],
  notePath: string,
) {
  for (const file of files) {
    const saved = await saveAttachment(file, notePath);
    if (!saved) continue;

    const node = imageWithSize.type(ctx).create({ src: saved.src });
    view.dispatch(view.state.tr.replaceSelectionWith(node).scrollIntoView());
  }
}

/**
 * Turns pasted and dropped image files into attachments.
 *
 * Both handlers bail unless the payload actually carries an image file, so an
 * ordinary markdown paste still falls through to `@milkdown/plugin-clipboard`.
 * Note the window is built with `drag_drop_enabled: false`, so the OS hands
 * file drops to the webview as plain HTML5 drop events rather than swallowing
 * them.
 */
export const attachmentPasteDrop = (notePath: string) =>
  $prose(
    (ctx) =>
      new Plugin({
        key: attachmentDropKey,
        props: {
          handlePaste: (view, event) => {
            const files = imageFiles(event.clipboardData);
            if (files.length === 0) return false;

            event.preventDefault();
            void insertImages(ctx, view, files, notePath);
            return true;
          },

          handleDrop: (view, event) => {
            const files = imageFiles(event.dataTransfer);
            if (files.length === 0) return false;

            event.preventDefault();

            // Move the caret to where the file was actually dropped before the
            // (async) save begins, so the insert lands under the pointer.
            const coords = view.posAtCoords({
              left: event.clientX,
              top: event.clientY,
            });
            if (coords) {
              const { tr, doc } = view.state;
              view.dispatch(
                tr.setSelection(TextSelection.near(doc.resolve(coords.pos))),
              );
            }

            void insertImages(ctx, view, files, notePath);
            return true;
          },
        },
      }),
  );
