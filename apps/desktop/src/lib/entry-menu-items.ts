import type { ComponentType } from 'react';
import {
  ArrowUpRight,
  Clipboard,
  Columns2,
  Copy,
  FileSearch,
  FolderInput,
  FolderTree,
  HardDrive,
  Link,
  PencilLine,
  SquarePlus,
  Trash,
} from 'lucide-react';

import { getFileIcon, getFolderIcon } from '@/assets/icons';
import { usePlatform } from '@/hooks/use-platform';
import { useFiles } from '@/hooks/use-files';
import * as entryActions from '@/lib/entry-actions';
import type { EntryTarget } from '@/lib/entry-actions';
import { FILE_TYPE_PRESETS, useEntryInput } from '@/lib/stores/entry-input';

/**
 * One description of the file/folder menus, rendered by whichever primitive
 * family the surface uses. The editor header is a dropdown and the explorer is
 * a context menu -- different Base UI components, but they must never drift
 * into offering different actions, so the list is written once here and the
 * components are passed in.
 */

/**
 * Lucide icons and the app's own file-type SVGs are both plain SVG
 * components; typing the field as the intersection lets a menu item carry
 * either without either import leaking into the other's call sites.
 */
type MenuIcon = ComponentType<{ className?: string }>;

export type EntryMenuItem =
  | {
      kind: 'item';
      id: string;
      label: string;
      icon: MenuIcon;
      destructive?: boolean;
      disabled?: boolean;
      run: () => void;
    }
  | { kind: 'separator'; id: string }
  | {
      kind: 'submenu';
      id: string;
      label: string;
      icon: MenuIcon;
      items: EntryMenuItem[];
    };

/** Which menu is being built, and what it is allowed to offer. */
/**
 * Where the menu is being shown. `viewer` is the editor header of a file the
 * app renders but cannot search or edit -- an image, a PDF, a media file -- so
 * it offers everything the editor surface does except find.
 */
export type EntryMenuSurface = 'editor' | 'tree' | 'root' | 'viewer';

export type EntryMenuOptions = {
  surface: EntryMenuSurface;
  renameEnabled?: boolean;
  deleteEnabled?: boolean;
  moveEnabled?: boolean;
};

/**
 * The system file manager's name differs per platform, and so does the verb
 * users expect. `usePlatform` is null for the first render, so the neutral
 * wording stands in until it resolves rather than guessing wrong.
 */
function useRevealInSystemLabel() {
  const platform = usePlatform();

  if (platform === 'macos') return 'Reveal in Finder';
  if (platform === 'windows') return 'Show in File Explorer';
  if (platform === 'linux') return 'Show in File Manager';

  return 'Show in System Explorer';
}

const separator = (id: string): EntryMenuItem => ({ kind: 'separator', id });

/**
 * Opening a dialog or the inline rename input has to wait for the menu to
 * finish closing. `EntryInput` cancels on blur, so an input mounted while the
 * menu is still tearing down would dismiss itself as focus moves.
 */
function deferred(run: () => void) {
  return () => setTimeout(run, 0);
}

export function useEntryMenuItems(
  target: EntryTarget,
  {
    surface,
    renameEnabled = true,
    deleteEnabled = true,
    moveEnabled = true,
  }: EntryMenuOptions,
): EntryMenuItem[] {
  const revealInSystemLabel = useRevealInSystemLabel();
  const expandDirectory = useFiles((s) => s.expandDirectory);
  const startCreateFile = useEntryInput((s) => s.startCreateFile);
  const startCreateFolder = useEntryInput((s) => s.startCreateFolder);

  const { path, is_dir: isDir } = target;
  const items: EntryMenuItem[] = [];

  // New entries land inside the folder, so it has to be showing them.
  const createIn = (start: () => void) => () => {
    void expandDirectory(path);
    start();
  };

  if (isDir) {
    for (const preset of Object.values(FILE_TYPE_PRESETS).filter((p) => p.creatable)) {
      items.push({
        kind: 'item',
        id: `new-${preset.id}`,
        label: `New ${preset.label.toLocaleLowerCase()}...`,
        icon: getFileIcon(preset.extension),
        run: createIn(() => startCreateFile(path, preset)),
      });
    }

    items.push({
      kind: 'item',
      id: 'new-folder',
      label: 'New folder...',
      icon: getFolderIcon(),
      run: createIn(() => startCreateFolder(path)),
    });
    items.push({
      kind: 'item',
      id: 'new-file',
      label: 'New file...',
      icon: getFileIcon(''),
      run: createIn(() => startCreateFile(path)),
    });
    items.push(separator('after-new'));
  }

  if (surface === 'editor') {
    items.push({
      kind: 'item',
      id: 'find',
      label: 'Find...',
      icon: FileSearch,
      run: () => entryActions.find(path),
    });
    items.push(separator('after-find'));
  }

  // A file already open in the editor is by definition already in view; from
  // the tree, opening a second view of it is the useful thing instead.
  if (!isDir && surface === 'tree') {
    items.push({
      kind: 'item',
      id: 'open-new-tab',
      label: 'Open in New Tab',
      icon: SquarePlus,
      run: () => entryActions.openInNewTab(path),
    });
    items.push({
      kind: 'item',
      id: 'open-to-side',
      label: 'Open to the Side',
      icon: Columns2,
      run: () => entryActions.openToTheSide(path),
    });
    items.push(separator('after-open'));
  }

  if (surface !== 'root') {
    items.push({
      kind: 'item',
      id: 'reveal-in-explorer',
      label: 'Reveal in Explorer',
      icon: FolderTree,
      run: () => void entryActions.revealInExplorer(path),
    });
  }

  items.push({
    kind: 'item',
    id: 'reveal-in-system',
    label: revealInSystemLabel,
    icon: ArrowUpRight,
    run: () => void entryActions.revealInSystem(path),
  });

  // Handing a folder to the OS just opens the file manager again, which is
  // what the item above already does.
  if (!isDir) {
    items.push({
      kind: 'item',
      id: 'open-in-default-app',
      label: 'Open in Default App',
      icon: ArrowUpRight,
      run: () => void entryActions.openInDefaultApp(path),
    });
  }

  items.push(separator('after-open-external'));

  items.push({
    kind: 'submenu',
    id: 'copy-path',
    label: 'Copy Path',
    icon: Clipboard,
    items: [
      {
        kind: 'item',
        id: 'copy-relative-path',
        label: 'Relative to Workspace',
        icon: FolderTree,
        // The workspace root's relative path is the empty string.
        disabled: surface === 'root',
        run: () => void entryActions.copyRelativePath(path),
      },
      {
        kind: 'item',
        id: 'copy-absolute-path',
        label: 'Absolute',
        icon: HardDrive,
        run: () => void entryActions.copyAbsolutePath(path),
      },
    ],
  });

  // Only files are wikilink targets.
  if (!isDir) {
    items.push({
      kind: 'item',
      id: 'copy-wikilink',
      label: 'Copy Wikilink',
      icon: Link,
      run: () => void entryActions.copyWikilink(path),
    });
  }

  if (surface !== 'root') {
    items.push(separator('after-copy'));

    items.push({
      kind: 'item',
      id: 'rename',
      label: 'Rename',
      icon: PencilLine,
      disabled: !renameEnabled,
      run: deferred(() => void entryActions.startRename(path)),
    });
    items.push({
      kind: 'item',
      id: 'duplicate',
      label: 'Duplicate',
      icon: Copy,
      run: () => void entryActions.duplicate(path),
    });
    items.push({
      kind: 'item',
      id: 'move',
      label: 'Move to...',
      icon: FolderInput,
      disabled: !moveEnabled,
      run: deferred(() => entryActions.requestMove(path)),
    });

    items.push(separator('before-delete'));

    items.push({
      kind: 'item',
      id: 'delete',
      label: 'Delete',
      icon: Trash,
      destructive: true,
      disabled: !deleteEnabled,
      run: deferred(() => entryActions.requestDelete(path)),
    });
  }

  return items;
}
