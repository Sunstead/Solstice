import { useState } from 'react';
import { Check, ChevronDown, CloudDownload, FolderOpen, Plus } from 'lucide-react';

import { Button } from '@sunstead/ui/components/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@sunstead/ui/components/sheet';
import { ExplorerTree, useCreateActions } from '@/components/explorer-sidebar';
import { useWorkspaceChoices } from '@/components/workspace-switcher';
import { useWorkspace } from '@/hooks/use-workspace';
import { can } from '@/lib/backend/platform';
import { useWorkspaceDialogs } from '@/lib/stores/workspace-dialogs';
import { PhoneHeader, Row, RowGroup } from './phone-parts';

/**
 * The phone's home: the workspace's files, full screen. Its header names the
 * workspace (tap to switch, like a Discord server's) and makes new things.
 * Mounted while another page shows, since the tree registers New Note.
 */
export function FilesPage({ hidden }: { hidden: boolean }) {
  const path = useWorkspace((s) => s.path);
  const loading = useWorkspace((s) => s.loading);
  const { activeName } = useWorkspaceChoices();
  const create = useCreateActions(path);
  const [workspacesOpen, setWorkspacesOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);

  return (
    <div hidden={hidden} inert={hidden} className='absolute inset-0 flex flex-col bg-sidebar'>
      <PhoneHeader>
        <button
          type='button'
          onClick={() => setWorkspacesOpen(true)}
          className='flex min-w-0 items-center gap-1 rounded-md px-1.5 py-1 text-base font-semibold active:bg-accent'
        >
          <span className='truncate'>{activeName ?? 'Solstice'}</span>
          <ChevronDown className='size-4 shrink-0 text-muted-foreground' />
        </button>
        <span data-tauri-drag-region className='flex-1 self-stretch' />
        {path && (
          <Button variant='ghost' size='icon' onClick={() => setCreateOpen(true)}>
            <Plus />
            <span className='sr-only'>New</span>
          </Button>
        )}
      </PhoneHeader>
      {path ? (
        // `phone` widens the tree to the screen and its rows to a thumb.
        <div data-phone='true' className='group/files flex min-h-0 flex-1 flex-col'>
          <ExplorerTree path={path} />
        </div>
      ) : (
        !loading && <NoWorkspace />
      )}

      <Sheet open={createOpen} onOpenChange={setCreateOpen}>
        {/* Focus stays where the new name's field puts it, or the field closes. */}
        <SheetContent side='bottom' finalFocus={false} className='gap-0 rounded-t-xl pb-[env(safe-area-inset-bottom)]'>
          <SheetHeader className='pb-2'>
            <SheetTitle>New</SheetTitle>
          </SheetHeader>
          <div className='px-4 pb-4'>
            <RowGroup>
              {create.map((action) => (
                <Row
                  key={action.id}
                  icon={action.icon}
                  label={action.label}
                  onClick={() => {
                    setCreateOpen(false);
                    action.run();
                  }}
                />
              ))}
            </RowGroup>
          </div>
        </SheetContent>
      </Sheet>
      <WorkspacesSheet open={workspacesOpen} onOpenChange={setWorkspacesOpen} />
    </div>
  );
}

/** Every workspace to switch to, and making or managing them. */
export function WorkspacesSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { activePath, workspaces, switchTo, actions, manage } = useWorkspaceChoices();
  const run = (action: () => void) => () => {
    onOpenChange(false);
    action();
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side='bottom' className='max-h-[85dvh] gap-0 rounded-t-xl pb-[env(safe-area-inset-bottom)]'>
        <SheetHeader className='pb-2'>
          <SheetTitle>Workspaces</SheetTitle>
        </SheetHeader>
        <div className='flex min-h-0 flex-col gap-5 overflow-y-auto px-4 pb-4'>
          {workspaces.length > 0 && (
            <RowGroup>
              {workspaces.map((workspace) => (
                <Row
                  key={workspace.path}
                  label={workspace.name}
                  detail={workspace.path === activePath && <Check className='size-4 text-primary' />}
                  onClick={run(() => switchTo(workspace.path))}
                />
              ))}
            </RowGroup>
          )}
          <RowGroup>
            {[...actions, manage].map((action) => (
              <Row key={action.id} icon={action.icon} label={action.label.replace(/…$/, '')} onClick={run(action.run)} />
            ))}
          </RowGroup>
        </div>
      </SheetContent>
    </Sheet>
  );
}

/** Nothing open yet (a first launch): the ways in. */
function NoWorkspace() {
  const show = useWorkspaceDialogs((s) => s.show);
  const openFolder = useWorkspace((s) => s.openFolder);

  return (
    <div className='flex min-h-0 flex-1 flex-col items-center justify-center gap-3 bg-background p-6 text-center'>
      <p className='text-sm text-muted-foreground'>No workspace open</p>
      <div className='flex w-full max-w-64 flex-col gap-2'>
        <Button onClick={() => show('new')}>
          <Plus />
          New workspace…
        </Button>
        {can.localFolders && (
          <Button variant='outline' onClick={() => show('import')}>
            <CloudDownload />
            Import from sync…
          </Button>
        )}
        {can.pickFolders && (
          <Button variant='outline' onClick={() => void openFolder()}>
            <FolderOpen />
            Open folder…
          </Button>
        )}
      </div>
    </div>
  );
}
