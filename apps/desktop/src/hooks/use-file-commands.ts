import { useEffect } from 'react';

import type { CommandId } from '@/bindings';
import { useLayout } from '@/hooks/use-layout';
import * as entryActions from '@/lib/entry-actions';
import { registerCommand, unregisterCommand } from '@/lib/commands';
import { can, shell } from '@/lib/backend/platform';
import { exportPdf, saveCopy, shareFile } from '@/lib/share/actions';
import { fileActions } from '@/lib/share/targets';

/**
 * The `file.*` commands that act on whatever file the focused tab has open.
 *
 * They are app-global rather than editor-scoped because none of them touch the
 * editor: they act on the file behind it, and stay meaningful while focus sits
 * in the sidebar or a menu. The path is resolved at run time from the layout
 * so a command bound to a key does the same thing as the menu item beside it.
 */
const HANDLERS: Array<[CommandId, (path: string) => unknown]> = [
  ['file.reveal_in_explorer', entryActions.revealInExplorer],
  ['file.reveal_in_system', entryActions.revealInSystem],
  ['file.open_in_default_app', entryActions.openInDefaultApp],
  ['file.copy_path', entryActions.copyAbsolutePath],
  ['file.copy_relative_path', entryActions.copyRelativePath],
  ['file.copy_wikilink', entryActions.copyWikilink],
  ['file.rename', entryActions.startRename],
  ['file.duplicate', entryActions.duplicate],
  ['file.move_to', entryActions.requestMove],
  ['file.delete', entryActions.requestDelete],
];

/**
 * As the file menus have it: a file manager to reveal in on a computer, and
 * a default app (on the web, a browser tab) to open in; a phone has neither.
 */
const available = ([id]: (typeof HANDLERS)[number]) =>
  (id !== 'file.reveal_in_system' || can.fileManager) && (id !== 'file.open_in_default_app' || shell !== 'mobile');

/**
 * Getting the file out, each greyed out for a file it can't do (a PDF has no
 * PDF to make): `fileActions` decides, as it does for the file menus.
 */
const SHARING: Array<[CommandId, (path: string) => boolean, (path: string) => unknown]> = [
  ['file.share', (path) => fileActions(path, can).share.includes('file'), (path) => shareFile(path, 'file')],
  ['file.share_pdf', (path) => fileActions(path, can).share.includes('pdf'), (path) => shareFile(path, 'pdf')],
  ['file.share_image', (path) => fileActions(path, can).share.includes('image'), (path) => shareFile(path, 'image')],
  ['file.export_pdf', (path) => fileActions(path, can).exportPdf, exportPdf],
  ['file.save_copy', () => true, saveCopy],
];

export function useFileCommands() {
  useEffect(() => {
    for (const [id, run] of HANDLERS.filter(available)) {
      registerCommand(
        id,
        () => {
          const path = useLayout.getState().getActiveFilePath();
          if (path) void run(path);
        },
        // A blank tab has no file, so these grey out in the menus instead of
        // silently doing nothing.
        () => useLayout.getState().getActiveFilePath() !== null,
      );
    }

    for (const [id, applies, run] of SHARING) {
      const path = () => useLayout.getState().getActiveFilePath();
      registerCommand(
        id,
        () => {
          const active = path();
          if (active && applies(active)) void run(active);
        },
        () => {
          const active = path();
          return active !== null && applies(active);
        },
      );
    }

    return () => {
      for (const [id] of [...HANDLERS, ...SHARING]) unregisterCommand(id);
    };
  }, []);
}
