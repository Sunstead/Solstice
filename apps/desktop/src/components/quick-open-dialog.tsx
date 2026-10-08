import { useShallow } from 'zustand/react/shallow';
import { FileSearchDialog } from '@/components/file-search-dialog';
import { selectAllFiles, useFileIndex } from '@/lib/stores/use-file-index';
import { FormattedFileName } from './file-tree';
import type { FileEntry } from '@/bindings';
import { getFileIcon } from '@/assets/icons';
import { getFileExtension } from '@/lib/utils';
import { getWorkspaceRelativeSegments } from '@/lib/path-utils';
import { useWorkspace } from '@/hooks/use-workspace';

type QuickOpenDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenFile: (path: string) => void;
  placeholder?: string;
};

export function QuickOpenDialog({
  open,
  onOpenChange,
  onOpenFile,
  placeholder = 'Open file...',
}: QuickOpenDialogProps) {
  const files = useFileIndex(useShallow(selectAllFiles));
  const workspacePath = useWorkspace((s) => s.path);

  if (!workspacePath) return null;

  return (
    <FileSearchDialog
      open={open}
      onOpenChange={onOpenChange}
      placeholder={placeholder}
      emptyMessage='No matching files.'
      heading='Files'
      entries={files}
      onSelect={(entry) => onOpenFile(entry.path)}
      renderItem={(entry) => <QuickOpenItem entry={entry} root={workspacePath} />}
    />
  );
}

/** A file as quick open lists it: its icon and name, and its folder below. */
export function QuickOpenItem({ entry, root }: { entry: Pick<FileEntry, 'name' | 'path'>; root: string }) {
  const Icon = getFileIcon(getFileExtension(entry.name));
  const { relative } = getWorkspaceRelativeSegments(entry.path, root);

  return (
    <div className='w-full'>
      <div className='flex w-full items-center justify-between gap-2'>
        <Icon />
        <FormattedFileName name={entry.name} />
      </div>
      <p className='text-xs text-muted-foreground truncate max-w-full'>{relative}</p>
    </div>
  );
}
