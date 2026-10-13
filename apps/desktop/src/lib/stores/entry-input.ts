import { create } from 'zustand';
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
  pdf: { id: 'pdf', label: 'PDF', extension: 'pdf' },
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

export function stripPresetExtension(fileName: string): {
  name: string;
  preset: FileTypePreset | null;
} {
  const extension = getFileExtension(fileName);
  const preset = getPresetByExtension(extension);
  const name = preset ? fileName.slice(0, -(extension.length + 1)) : fileName;

  return { name, preset };
}

export type EntryKind =
  { type: 'folder' } | { type: 'file'; preset: FileTypePreset | null }; // null preset = extension is just part of the name

export type EntryOperation =
  | { mode: 'create'; parentPath: string; kind: EntryKind }
  | { mode: 'rename'; path: string; kind: EntryKind; initialName: string };

interface EntryInputState {
  operation: EntryOperation | null;
  startCreateFile: (parentPath: string, preset?: FileTypePreset) => void;
  startCreateFolder: (parentPath: string) => void;
  startRename: (node: { path: string; name: string; is_dir: boolean }) => void;
  cancel: () => void;
}

export const useEntryInput = create<EntryInputState>((set) => ({
  operation: null,

  startCreateFile: (parentPath, preset) =>
    set({
      operation: {
        mode: 'create',
        parentPath,
        kind: { type: 'file', preset: preset ?? null },
      },
    }),

  startCreateFolder: (parentPath) =>
    set({
      operation: { mode: 'create', parentPath, kind: { type: 'folder' } },
    }),

  startRename: (node) => {
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
