import { useEffect, useState } from 'react';

import { EllipsisVertical, FolderOpen, Trash2 } from 'lucide-react';

import { Button } from '@sunstead/ui/components/button';
import { DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@sunstead/ui/components/dropdown-menu';
import { Input } from '@sunstead/ui/components/input';
import { can } from '@/lib/backend/platform';
import { deleteVault, resolve } from '@/lib/backend/web/vault';
import { useWorkspace } from '@/hooks/use-workspace';
import { type KnownWorkspace, useKnownWorkspaces } from '@/lib/stores/known-workspaces';
import { useWorkspaceMeta, workspaceColor } from '@/lib/stores/workspace-meta';
import { WorkspaceColorPicker } from '@/components/workspace-color-picker';
import { WorkspaceIcon } from '@/components/workspace-icon';
import { refreshWorkspaceColors } from '@/hooks/use-workspace-choices';

/**
 * The workspace list, and taking workspaces off it. On desktop that only
 * forgets the workspace: its folder stays, and since it's no longer open it no
 * longer syncs. On the web a workspace is a vault, so removing it deletes the
 * vault (into the server's trash), after typing its name. Each workspace's
 * icon opens its color picker.
 */
export function ManageWorkspacesForm({ onDone }: { onDone: () => void }) {
  const workspaces = useKnownWorkspaces((s) => s.workspaces);
  const active = useWorkspace((s) => s.path);
  const [confirming, setConfirming] = useState<string | null>(null);

  // Colors picked on other devices since.
  useEffect(refreshWorkspaceColors, []);

  return (
    <>
      <DialogHeader>
        <DialogTitle>Workspaces</DialogTitle>
        <DialogDescription>
          {can.localFolders
            ? 'Removing a workspace takes it off this list. Its folder and files stay where they are.'
            : "Each workspace is a vault on this server. Deleting one moves its notes to the server's trash."}
        </DialogDescription>
      </DialogHeader>

      <ul className='grid max-h-80 gap-1 overflow-y-auto text-sm'>
        {workspaces.map((w) => (
          <li key={w.path} className='rounded-md border'>
            <Row
              workspace={w}
              open={w.path === active}
              confirming={confirming === w.path}
              onConfirm={(on) => setConfirming(on ? w.path : null)}
              onOpened={onDone}
            />
          </li>
        ))}
        {workspaces.length === 0 && <li className='text-muted-foreground'>No workspaces yet.</li>}
      </ul>

      <DialogFooter>
        <Button type='button' variant='outline' onClick={onDone}>
          Done
        </Button>
      </DialogFooter>
    </>
  );
}

function Row({
  workspace,
  open,
  confirming,
  onConfirm,
  onOpened,
}: {
  workspace: KnownWorkspace;
  open: boolean;
  confirming: boolean;
  onConfirm: (on: boolean) => void;
  onOpened: () => void;
}) {
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const stored = useWorkspaceMeta((s) => s.colors[workspace.path] ?? null);
  const color = workspaceColor(workspace.name, stored);

  const remove = async () => {
    setBusy(true);
    setError(null);
    try {
      if (!can.localFolders) {
        const { vault } = await resolve(workspace.path);
        await deleteVault(vault.id);
      }
      await useKnownWorkspaces.getState().forget(workspace.path);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <div className='grid gap-2 p-2'>
      <div className='flex items-center gap-2'>
        <WorkspaceColorPicker
          color={color}
          picked={stored !== null}
          onChange={(next) => useWorkspaceMeta.getState().setColor(workspace.path, next)}
          trigger={
            <button
              type='button'
              title='Change color'
              className='rounded-[28%] outline-offset-2 focus-visible:outline-2 focus-visible:outline-ring'
            >
              <WorkspaceIcon name={workspace.name} color={color} size='lg' />
            </button>
          }
        />
        <div className='grid min-w-0 flex-1'>
          <span className='truncate font-medium'>{workspace.name}</span>
          {/* Only where the folder was picked: a phone's are all in its Documents. */}
          {can.pickFolders && (
            <span className='truncate text-xs text-muted-foreground' title={workspace.path}>
              {workspace.path}
            </span>
          )}
        </div>
        {open ? (
          <span className='text-xs text-muted-foreground'>Open</span>
        ) : (
          !confirming && (
            <DropdownMenu>
              <DropdownMenuTrigger
                render={<Button type='button' variant='ghost' size='icon-sm' aria-label='Workspace options' />}
              >
                <EllipsisVertical />
              </DropdownMenuTrigger>
              <DropdownMenuContent align='end'>
                <DropdownMenuItem onClick={() => {
                    onOpened();
                    void useWorkspace.getState().setWorkspace(workspace.path);
                  }}>
                  <FolderOpen />
                  Open
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant='destructive' onClick={() => onConfirm(true)}>
                  <Trash2 />
                  {can.localFolders ? 'Remove' : 'Delete…'}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )
        )}
      </div>

      {confirming && can.localFolders && (
        <div className='flex items-center justify-end gap-2'>
          <span className='mr-auto text-xs text-muted-foreground'>Remove from the list? The folder stays.</span>
          <Button type='button' variant='outline' size='sm' onClick={() => onConfirm(false)}>
            Cancel
          </Button>
          <Button type='button' variant='destructive' size='sm' disabled={busy} onClick={() => void remove()}>
            Remove
          </Button>
        </div>
      )}

      {confirming && !can.localFolders && (
        <form
          className='grid gap-2'
          onSubmit={(e) => {
            e.preventDefault();
            if (typed === workspace.name) void remove();
          }}
        >
          <p className='text-xs text-muted-foreground'>
            This deletes the vault for everyone: its notes move to the server's trash, and computers syncing it stop
            (their copies stay). Type <span className='font-medium text-foreground'>{workspace.name}</span> to
            confirm.
          </p>
          <Input value={typed} autoFocus onChange={(e) => setTyped(e.target.value)} aria-label='Vault name' />
          <div className='flex justify-end gap-2'>
            <Button type='button' variant='outline' size='sm' onClick={() => onConfirm(false)}>
              Cancel
            </Button>
            <Button type='submit' variant='destructive' size='sm' disabled={busy || typed !== workspace.name}>
              {busy ? 'Deleting…' : 'Delete vault'}
            </Button>
          </div>
        </form>
      )}

      {error && <p className='text-xs text-destructive select-text'>{error}</p>}
    </div>
  );
}
