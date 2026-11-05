import { $prose } from '@milkdown/kit/utils';
import { Plugin, PluginKey } from '@milkdown/kit/prose/state';
import type { EditorView } from '@milkdown/kit/prose/view';
import type { Ctx } from '@milkdown/kit/ctx';

import { useWorkspace } from '@/hooks/use-workspace';
import { wikiEmbedSchema } from '@/lib/embed/schema';
import { imageWithSize } from '@/lib/image/schema';
import { useWikilinkIndex } from '@/lib/stores/wikilink-index';
import { saveAttachment } from './attachments';
import { textCaretNear } from './caret-near';
import { entryLink, registerNoteDrop, type NoteDrop } from './note-drop';

const attachmentDropKey = new PluginKey('solstice-attachment-drop');

/** Every file a drop carries, images first (they embed), then the rest (linked). */
function droppedFiles(transfer: DataTransfer | null): File[] {
  return transfer ? Array.from(transfer.files) : [];
}

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
async function insertAttachments(
  ctx: Ctx,
  view: EditorView,
  files: File[],
  notePath: string,
) {
  for (const file of files) {
    const saved = await saveAttachment(file, notePath);
    if (!saved) continue;

    if (file.type.startsWith('image/')) {
      const node = imageWithSize.type(ctx).create({ src: saved.src });
      view.dispatch(view.state.tr.replaceSelectionWith(node).scrollIntoView());
    } else {
      // Anything else is a link to its copy, named for the file.
      const link = view.state.schema.marks.link.create({ href: saved.src });
      const text = view.state.schema.text(file.name || saved.src, [link]);
      view.dispatch(view.state.tr.replaceSelectionWith(text, false).insertText(' ').scrollIntoView());
    }
  }
}

/** Moves the caret to where something was dropped, so the insert lands under the pointer. */
function caretAt(view: EditorView, left: number, top: number) {
  const coords = view.posAtCoords({ left, top });
  const caret = coords && textCaretNear(view.state.doc, coords.pos);
  if (caret) view.dispatch(view.state.tr.setSelection(caret));
}

/** A Shift-drop, through the layout's overlay (`dropIntoNoteAt`). */
function takeNoteDrop(ctx: Ctx, view: EditorView, notePath: string, drop: NoteDrop): boolean {
  const root = useWorkspace.getState().path;
  caretAt(view, drop.x, drop.y);
  if (drop.entry && root) {
    const { embed, target } = entryLink(drop.entry, root, useWikilinkIndex.getState());
    const tr = view.state.tr;
    if (embed) tr.replaceSelectionWith(wikiEmbedSchema.type(ctx).create({ value: target }));
    else tr.insertText(`[[${target}]]`);
    view.dispatch(tr.scrollIntoView());
  } else {
    void insertAttachments(ctx, view, drop.files, notePath);
  }
  view.focus();
  return true;
}

/**
 * Turns pasted image files, and dropped files of any kind, into attachments:
 * an image embeds, anything else is linked.
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
        view: (view) => {
          registerNoteDrop(view.dom, (drop) => takeNoteDrop(ctx, view, notePath, drop));
          return {};
        },
        props: {
          handlePaste: (view, event) => {
            const files = imageFiles(event.clipboardData);
            if (files.length === 0) return false;

            event.preventDefault();
            void insertAttachments(ctx, view, files, notePath);
            return true;
          },

          handleDrop: (view, event) => {
            const files = droppedFiles(event.dataTransfer);
            if (files.length === 0) return false;

            event.preventDefault();

            // Before the (async) save begins.
            caretAt(view, event.clientX, event.clientY);

            void insertAttachments(ctx, view, files, notePath);
            return true;
          },
        },
      }),
  );
