import type { ComponentType } from 'react';

import { getFileIcon, getFolderIcon } from '@/assets/icons';
import { FILE_TYPE_PRESETS, type FileTypePreset, useEntryInput } from '@/lib/stores/entry-input';

export type CreateAction = {
  id: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  run: () => void;
};

/** What can be made at the workspace's root: each creatable type, a folder, a file. */
export function useCreateActions(path: string | null): CreateAction[] {
  const startCreateFile = useEntryInput((s) => s.startCreateFile);
  const startCreateFolder = useEntryInput((s) => s.startCreateFolder);
  if (!path) return [];
  return [
    ...Object.values(FILE_TYPE_PRESETS)
      .filter((p) => p.creatable)
      .map((preset: FileTypePreset) => ({
        id: preset.id,
        label: preset.label,
        icon: getFileIcon(preset.extension),
        run: () => startCreateFile(path, preset),
      })),
    { id: 'folder', label: 'Folder', icon: getFolderIcon(), run: () => startCreateFolder(path) },
    { id: 'file', label: 'File', icon: getFileIcon(''), run: () => startCreateFile(path) },
  ];
}
