import type { ComponentType } from 'react';

import { getFileIcon, getFolderIcon } from '@/assets/icons';
import { FILE_TYPE_PRESETS, type FileTypePreset, useEntryInput } from '@/lib/stores/entry-input';

export type CreateAction = {
  id: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  run: () => void;
};

/**
 * What can be made in a folder (the workspace's root, say): each creatable
 * type, a folder, a file. `dialog`: named in a dialog, where the tree isn't.
 */
export function useCreateActions(path: string | null, options?: { dialog?: boolean }): CreateAction[] {
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
        run: () => startCreateFile(path, preset, options),
      })),
    { id: 'folder', label: 'Folder', icon: getFolderIcon(), run: () => startCreateFolder(path, options) },
    { id: 'file', label: 'File', icon: getFileIcon(''), run: () => startCreateFile(path, undefined, options) },
  ];
}
