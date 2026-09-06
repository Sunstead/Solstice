import { useShallow } from 'zustand/react/shallow';

import { getFileIcon } from '@/assets/icons';
import { FileSearchDialog } from '@/components/file-search-dialog';
import { FormattedFileName } from '@/components/file-tree';
import { useWorkspace } from '@/hooks/use-workspace';
import { getWorkspaceRelativeSegments } from '@/lib/path-utils';
import { selectAllFiles, useFileIndex } from '@/lib/stores/use-file-index';
import { getFileExtension } from '@/lib/utils';

/**
 * Picks a workspace file for a new file card, wrapping the same dialog
 * quick-open uses. The path handed back is workspace-relative, which is what
 * JSON Canvas stores.
 */
export function CanvasFilePicker({
  open,
  onOpenChange,
  onPick,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (relativePath: string) => void;
}) {
  const files = useFileIndex(useShallow(selectAllFiles));
  const workspacePath = useWorkspace((state) => state.path);

  if (!workspacePath) return null;

  return (
    <FileSearchDialog
      open={open}
      onOpenChange={onOpenChange}
      placeholder='Add a file to the canvas...'
      emptyMessage='No matching files.'
      heading='Files'
      entries={files}
      onSelect={(entry) => {
        const { relative } = getWorkspaceRelativeSegments(
          entry.path,
          workspacePath,
        );
        onPick(relative);
        onOpenChange(false);
      }}
      renderItem={(entry) => {
        const Icon = getFileIcon(getFileExtension(entry.name));
        const { relative } = getWorkspaceRelativeSegments(
          entry.path,
          workspacePath,
        );

        return (
          <div className='w-full'>
            <div className='flex w-full items-center justify-between gap-2'>
              <Icon />
              <FormattedFileName name={entry.name} />
            </div>
            <p className='max-w-full truncate text-xs text-muted-foreground'>
              {relative}
            </p>
          </div>
        );
      }}
    />
  );
}
