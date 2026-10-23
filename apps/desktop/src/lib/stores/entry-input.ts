import { create } from 'zustand';

import { primeKeyboard } from '@/lib/keyboard-primer';
import { can } from '@/lib/backend/platform';
import { getFileExtension } from '@/lib/utils';

export type FileTypePreset = {
  id: string;
  label: string;
  extension: string;
  /**
   * Written immediately after creation, for formats where a zero-byte file is
   * not a valid empty document.
   *
   * `create_file` makes an empty file, which is fine for a note and wrong for
   * a canvas: `""` is not JSON. Seeding here rather than papering over it in
   * the reader means the file is also valid to everything *outside* this app
   * -- git, Obsidian, `jq` -- from the moment it exists.
   */
  initialContents?: string;
  creatable?: boolean;
  /**
   * Made by something other than an empty file: a notebook is a PDF the iOS
   * app draws. Gets the new file's path.
   */
  create?: (path: string) => Promise<unknown>;
};

export const FILE_TYPE_PRESETS: Record<string, FileTypePreset> = {
  markdown: { id: 'markdown', label: 'Note', extension: 'md', creatable: true },
  canvas: {
    id: 'canvas',
    label: 'Canvas',
    extension: 'canvas',
    initialContents: '{\n  "nodes": [],\n  "edges": []\n}\n',
    creatable: true,
  },
  // A note shown as a Kanban board: `##` columns, checkbox cards
  // (`lib/task-board/`).
  task: {
    id: 'task',
    label: 'Task Board',
    extension: 'task.md',
    initialContents: '## To Do\n\n## Doing\n\n## Done\n',
    creatable: true,
  },
  pdf: { id: 'pdf', label: 'PDF', extension: 'pdf' },
  // An infinite canvas to draw on, in the iOS app (`DrawingFile.swift`); an
  // SVG picture everywhere else.
  drawing: {
    id: 'drawing',
    label: 'Drawing',
    extension: 'drawing.svg',
    initialContents:
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 768" width="1024" height="768"></svg>\n',
    creatable: can.nativeViews,
  },
  // A4 pages to write on, in the iOS app (see `Notebook.swift`); a PDF to
  // everything else.
  notebook: {
    id: 'notebook',
    label: 'Notebook',
    extension: 'pdf',
    creatable: can.nativeViews,
    create: async (path) => {
      const { nativeSurfaces } = await import('@/lib/backend/native');
      const { getSetting } = await import('@/lib/settings/store');
      await nativeSurfaces.createNotebook(path, getSetting('ink.notebookTemplate'));
    },
  },
};

export function getPresetByExtension(extension: string): FileTypePreset | null {
  return (
    Object.values(FILE_TYPE_PRESETS).find((p) => p.extension === extension) ??
    null
  );
}

/**
 * The preset a file name has, a two-part extension (`drawing.svg`) before
 * its last one (`svg`).
 */
export function getPresetForName(fileName: string): FileTypePreset | null {
  const lower = fileName.toLowerCase();
  const compound = Object.values(FILE_TYPE_PRESETS).find(
    (p) => p.extension.includes('.') && lower.endsWith(`.${p.extension}`) && lower.length > p.extension.length + 1,
  );
  return compound ?? getPresetByExtension(getFileExtension(fileName));
}

export function stripPresetExtension(fileName: string): {
  name: string;
  preset: FileTypePreset | null;
} {
  const preset = getPresetForName(fileName);
  const name = preset ? fileName.slice(0, -(preset.extension.length + 1)) : fileName;

  return { name, preset };
}

export type EntryKind =
  { type: 'folder' } | { type: 'file'; preset: FileTypePreset | null }; // null preset = extension is just part of the name

export type EntryOperation =
  /** `dialog`: named in `NameEntryDialog` even where the tree names inline (the tree isn't in view). */
  | { mode: 'create'; parentPath: string; kind: EntryKind; dialog?: boolean }
  | { mode: 'rename'; path: string; kind: EntryKind; initialName: string };

interface EntryInputState {
  operation: EntryOperation | null;
  startCreateFile: (parentPath: string, preset?: FileTypePreset, options?: { dialog?: boolean }) => void;
  startCreateFolder: (parentPath: string, options?: { dialog?: boolean }) => void;
  startRename: (node: { path: string; name: string; is_dir: boolean }) => void;
  cancel: () => void;
}

export const useEntryInput = create<EntryInputState>((set) => ({
  operation: null,

  // Each raises the keyboard straight away on a touch screen, while still in
  // the tap that asked: the naming dialog's field comes a moment later.
  startCreateFile: (parentPath, preset, options) => {
    primeKeyboard();
    set({
      operation: {
        mode: 'create',
        parentPath,
        kind: { type: 'file', preset: preset ?? null },
        dialog: options?.dialog,
      },
    });
  },

  startCreateFolder: (parentPath, options) => {
    primeKeyboard();
    set({
      operation: { mode: 'create', parentPath, kind: { type: 'folder' }, dialog: options?.dialog },
    });
  },

  startRename: (node) => {
    primeKeyboard();
    if (node.is_dir) {
      set({
        operation: {
          mode: 'rename',
          path: node.path,
          kind: { type: 'folder' },
          initialName: node.name,
        },
      });
      return;
    }

    const { name: initialName, preset } = stripPresetExtension(node.name);

    set({
      operation: {
        mode: 'rename',
        path: node.path,
        kind: { type: 'file', preset },
        initialName,
      },
    });
  },

  cancel: () => set({ operation: null }),
}));
