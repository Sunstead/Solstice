import { Trash2Icon } from 'lucide-react';
import { useIsMac } from '@/hooks/use-platform';
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { usePhoneSheets } from '@/hooks/use-phone-sheets';
import { shell } from '@/lib/backend/platform';
import { haptics } from '@/lib/haptics';
import { useFileActionDialog } from '@/lib/stores/file-action-dialog';
import { fileOperations } from '@/lib/file-operations';
import { MoveToFolderDialog } from './move-to-folder-dialog';
import { NameEntryDialog } from './name-entry-dialog';
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
} from '@sunstead/ui/components/alert-dialog';

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
  const isMac = useIsMac();
  const deleteTarget = useFileActionDialog((s) => s.deleteTarget);
  const moveTarget = useFileActionDialog((s) => s.moveTarget);
  const closeDelete = useFileActionDialog((s) => s.closeDelete);
  const closeMove = useFileActionDialog((s) => s.closeMove);

  const phone = usePhoneSheets();

  const itemName = deleteTarget?.is_dir ? 'folder' : 'file';
  // Named for what the user will go looking in if they change their mind. A
  // phone's trash is the workspace's own.
  const trashName = shell === 'mobile' ? "workspace's trash" : isMac ? 'system trash' : 'Recycle Bin';
  const remove = () => {
    if (deleteTarget) {
      haptics.play('warning');
      fileOperations.remove(deleteTarget);
    }
    closeDelete();
  };

  return (
    <>
      {phone ? (
        <DeleteSheet
          name={deleteTarget?.name ?? null}
          description={`This ${itemName} will be moved to the ${trashName}.`}
          onDelete={remove}
          onCancel={closeDelete}
        />
      ) : (
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
                This {itemName} will be moved to the {trashName}.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel variant='outline'>Cancel</AlertDialogCancel>
              <AlertDialogAction variant='destructive' onClick={remove}>
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}

      <NameEntryDialog />

      <MoveToFolderDialog
        open={moveTarget !== null}
        onOpenChange={(open) => !open && closeMove()}
        excludePath={moveTarget?.path}
        onSelectFolder={(destDir) => {
          if (moveTarget) {
            haptics.play('success');
            fileOperations.move(moveTarget, destDir);
          }
          closeMove();
        }}
      />
    </>
  );
}

/**
 * Deleting on a phone: an action sheet, as iOS asks it, with what's about to
 * go above a red Delete, and Cancel apart below.
 */
function DeleteSheet({
  name,
  description,
  onDelete,
  onCancel,
}: {
  name: string | null;
  description: string;
  onDelete: () => void;
  onCancel: () => void;
}) {
  return (
    <Sheet open={name !== null} onOpenChange={(open) => !open && onCancel()}>
      <SheetContent
        side='bottom'
        showCloseButton={false}
        finalFocus={false}
        className='gap-2 border-0 bg-transparent px-2 pb-[max(env(safe-area-inset-bottom),0.5rem)] shadow-none'
      >
        <div className='overflow-hidden rounded-2xl bg-sidebar'>
          <div className='flex flex-col items-center gap-0.5 px-4 py-3.5 text-center'>
            <SheetTitle className='text-[13px] font-semibold text-muted-foreground'>Delete “{name}”?</SheetTitle>
            <SheetDescription className='text-[13px]'>{description}</SheetDescription>
          </div>
          <button
            type='button'
            onClick={onDelete}
            className='h-14 w-full border-t text-[17px] text-destructive active:bg-accent'
          >
            Delete
          </button>
        </div>
        <SheetClose
          render={
            <button type='button' className='phone-tint h-14 w-full rounded-2xl bg-sidebar text-[17px] font-semibold active:bg-accent' />
          }
        >
          Cancel
        </SheetClose>
      </SheetContent>
    </Sheet>
  );
}
