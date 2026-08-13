import { create } from 'zustand';
import { getFileExtension } from '@/lib/utils';

export type FileTypePreset = {
  id: string;
  label: string;
  extension: string;
};

export const FILE_TYPE_PRESETS: Record<string, FileTypePreset> = {
  markdown: { id: 'markdown', label: 'Note', extension: 'md' },
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
