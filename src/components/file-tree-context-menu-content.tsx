import { FileTreeNode, useFiles } from '@/hooks/use-files';
import { useEntryInput, FILE_TYPE_PRESETS } from '@/lib/stores/entry-input';
import { fileOperations } from '@/lib/file-operations';
import {
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
} from './ui/context-menu';
import { PencilLine, Trash, Trash2Icon } from 'lucide-react';
import {
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
  AlertDialog,
} from './ui/alert-dialog';

export function FileTreeItemContextMenuContent({
  node,
  renameEnabled = true,
  deleteEnabled = true,
  deleteDialogOpen = false,
  onDeleteDialogOpenChange,
}: {
  node: FileTreeNode;
  renameEnabled?: boolean;
  deleteEnabled?: boolean;
  deleteDialogOpen?: boolean;
  onDeleteDialogOpenChange?: (open: boolean) => void;
}) {
  const expandDirectory = useFiles((s) => s.expandDirectory);
  const startCreateFile = useEntryInput((s) => s.startCreateFile);
  const startCreateFolder = useEntryInput((s) => s.startCreateFolder);
  const startRename = useEntryInput((s) => s.startRename);

  const ensureExpanded = () => {
    if (!node.expanded) {
      expandDirectory(node.path);
    }
  };

  const itemName = node.is_dir ? 'folder' : 'file';

  return (
    <>
      <AlertDialog
        open={deleteDialogOpen}
        onOpenChange={onDeleteDialogOpenChange}
      >
        <AlertDialogContent size='sm'>
          <AlertDialogHeader>
            <AlertDialogMedia className='bg-destructive/10 text-destructive dark:bg-destructive/20 dark:text-destructive'>
              <Trash2Icon />
            </AlertDialogMedia>
            <AlertDialogTitle>Delete {itemName}?</AlertDialogTitle>
            <AlertDialogDescription>
              This {itemName} will be permanently deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel variant='outline'>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant='destructive'
              onClick={() => fileOperations.remove(node)}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <ContextMenuContent>
        {node.is_dir && (
          <>
            {Object.values(FILE_TYPE_PRESETS).map((preset) => (
              <ContextMenuItem
                key={preset.id}
                onClick={() => {
                  ensureExpanded();
                  startCreateFile(node.path, preset);
                }}
              >
                New {preset.label}
              </ContextMenuItem>
            ))}
            <ContextMenuItem
              onClick={() => {
                ensureExpanded();
                startCreateFolder(node.path);
              }}
            >
              New Folder
            </ContextMenuItem>
            <ContextMenuItem
              onClick={() => {
                ensureExpanded();
                startCreateFile(node.path);
              }}
            >
              New File
            </ContextMenuItem>
            <ContextMenuSeparator />
          </>
        )}
        <ContextMenuItem
          onClick={() => {
            setTimeout(() => startRename(node), 0);
          }}
          disabled={!renameEnabled}
        >
          <PencilLine />
          Rename
        </ContextMenuItem>
        <ContextMenuItem
          variant='destructive'
          onClick={() => {
            setTimeout(
              () => onDeleteDialogOpenChange && onDeleteDialogOpenChange(true),
              0,
            );
          }}
          disabled={!deleteEnabled}
        >
          <Trash />
          Delete
        </ContextMenuItem>
      </ContextMenuContent>
    </>
  );
}
