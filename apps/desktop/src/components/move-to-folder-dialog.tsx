import { FolderRoot } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { FileSearchDialog } from '@/components/file-search-dialog';
import { selectAllFolders, useFileIndex } from '@/lib/stores/use-file-index';
import { getWorkspaceRelativeSegments } from '@/lib/path-utils';
import { useWorkspace } from '@/hooks/use-workspace';
import { getFolderIcon } from '@/assets/icons';
import { FileEntry } from '@/bindings';

type MoveToFolderDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Path of the file/folder being moved, so it (and its own subtree if a
   *  folder) can be excluded from the destination list. */
  excludePath?: string;
  onSelectFolder: (path: string) => void;
};

function normalize(path: string) {
  return path.replace(/\\/g, '/');
}

function isWithinSubtree(entryPath: string, rootPath: string) {
  const normalizedEntry = normalize(entryPath);
  const normalizedRoot = normalize(rootPath);

  return (
    normalizedEntry === normalizedRoot ||
    normalizedEntry.startsWith(`${normalizedRoot}/`)
  );
}

export function MoveToFolderDialog({
  open,
  onOpenChange,
  excludePath,
  onSelectFolder,
}: MoveToFolderDialogProps) {
  const allFolders = useFileIndex(useShallow(selectAllFolders));
  const folders = excludePath
    ? allFolders.filter((entry) => !isWithinSubtree(entry.path, excludePath))
    : allFolders;

  const workspacePath = useWorkspace((s) => s.path);

  if (!workspacePath) return null;

  const showRoot = !excludePath || !isWithinSubtree(workspacePath, excludePath);

  const rootEntry: FileEntry = {
    path: workspacePath,
    name: workspacePath,
    is_dir: true,
  };

  const entries = showRoot ? [rootEntry, ...folders] : folders;

  return (
    <FileSearchDialog
      open={open}
      onOpenChange={onOpenChange}
      placeholder='Move to folder...'
      emptyMessage='No matching folders.'
      heading='Folders'
      entries={entries}
      onSelect={(entry) => onSelectFolder(entry.path)}
      renderItem={(entry) => {
        const isRoot = normalize(entry.path) === normalize(workspacePath);

        if (isRoot) {
          const { workspaceName } = getWorkspaceRelativeSegments(
            entry.path,
            workspacePath,
          );
          return (
            <div className='flex items-start gap-2'>
              <FolderRoot className='my-0.5' />
              {workspaceName}
            </div>
          );
        }

        const { relative } = getWorkspaceRelativeSegments(
          entry.path,
          workspacePath,
        );
        const Icon = getFolderIcon();
        return (
          <div className='flex items-start gap-2'>
            <Icon className='my-0.5' />
            {relative}
          </div>
        );
      }}
    />
  );
}
