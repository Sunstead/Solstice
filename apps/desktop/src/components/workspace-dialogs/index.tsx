import { Dialog, DialogContent } from '@sunstead/ui/components/dialog';
import { useWorkspaceDialogs } from '@/lib/stores/workspace-dialogs';
import { ImportFromSyncForm } from './import-from-sync-dialog';
import { ManageWorkspacesForm } from './manage-workspaces-dialog';
import { NewWorkspaceForm } from './new-workspace-dialog';

/**
 * The workspace dialogs, one at a time, opened through `useWorkspaceDialogs`
 * (the switcher and the File menu). Each form mounts fresh when it opens.
 */
export function WorkspaceDialogs() {
  const dialog = useWorkspaceDialogs((s) => s.dialog);
  const close = useWorkspaceDialogs((s) => s.close);

  return (
    <Dialog open={dialog !== null} onOpenChange={(open) => !open && close()}>
      <DialogContent className='sm:max-w-lg'>
        {dialog === 'new' && <NewWorkspaceForm onDone={close} />}
        {dialog === 'import' && <ImportFromSyncForm onDone={close} />}
        {dialog === 'manage' && <ManageWorkspacesForm onDone={close} />}
      </DialogContent>
    </Dialog>
  );
}
