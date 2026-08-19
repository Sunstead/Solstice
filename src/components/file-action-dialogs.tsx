import { Trash2Icon } from 'lucide-react';
import { useFileActionDialog } from '@/lib/stores/file-action-dialog';
import { fileOperations } from '@/lib/file-operations';
import { MoveToFolderDialog } from './move-to-folder-dialog';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from './ui/alert-dialog';

/**
 * Single, app-wide instance of the delete-confirmation and move-to-folder
 * dialogs, driven by `useFileActionDialog`. Deliberately NOT rendered
 * per-tree-row, and rendered OUTSIDE any `<ContextMenu>` tree.
 *
 * Both dialogs are portal-based (render into document.body), but React
 * re-bubbles events from portaled content through the *React* component
 * tree they were mounted in, not the actual DOM tree. Nesting a Dialog
 * inside a ContextMenu therefore means a right-click anywhere inside the
 * open dialog also reaches the ancestor ContextMenu and reopens it. A
 * single instance mounted outside any ContextMenu avoids that entirely —
 * and avoids mounting a Dialog + full Command/file-index instance per row.
 */
export function FileActionDialogs() {
  const deleteTarget = useFileActionDialog((s) => s.deleteTarget);
  const moveTarget = useFileActionDialog((s) => s.moveTarget);
  const closeDelete = useFileActionDialog((s) => s.closeDelete);
  const closeMove = useFileActionDialog((s) => s.closeMove);

  const itemName = deleteTarget?.is_dir ? 'folder' : 'file';

  return (
    <>
      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && closeDelete()}
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
              onClick={() => {
                if (deleteTarget) fileOperations.remove(deleteTarget);
                closeDelete();
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <MoveToFolderDialog
        open={moveTarget !== null}
        onOpenChange={(open) => !open && closeMove()}
        excludePath={moveTarget?.path}
        onSelectFolder={(destDir) => {
          if (moveTarget) fileOperations.move(moveTarget, destDir);
          closeMove();
        }}
      />
    </>
  );
}