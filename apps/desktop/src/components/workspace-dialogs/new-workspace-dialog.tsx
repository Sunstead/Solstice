import { useState } from 'react';

import { Button } from '@sunstead/ui/components/button';
import {
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@sunstead/ui/components/input';
import { Label } from '@sunstead/ui/components/label';
import { Switch } from '@sunstead/ui/components/switch';
import { commands } from '@/lib/backend';
import { can } from '@/lib/backend/platform';
import { useWorkspace } from '@/hooks/use-workspace';
import { useKnownWorkspaces } from '@/lib/stores/known-workspaces';
import { useSync } from '@/lib/stores/sync';
import { useWorkspaceDialogs } from '@/lib/stores/workspace-dialogs';
import { useWorkspaceMeta } from '@/lib/stores/workspace-meta';
import { defaultWorkspaceColor } from '@/lib/workspace/color';
import { WorkspaceColorPicker } from '@/components/workspace-color-picker';
import { WorkspaceIcon } from '@/components/workspace-icon';
import { useSyncAccount, useWorkspaceParent } from './helpers';
import { LocationField, SyncSignIn } from './shared';

/**
 * Makes a workspace, as opposed to opening a folder or importing one from
 * sync. On desktop: a name, where to put it, and whether to sync it (to a new
 * vault of the same name). On the web a workspace is a vault on the server,
 * so only the name. Its icon follows the name until a color is picked.
 */
export function NewWorkspaceForm({ onDone }: { onDone: () => void }) {
  const setWorkspace = useWorkspace((s) => s.setWorkspace);
  const showDialog = useWorkspaceDialogs((s) => s.show);
  const account = useSyncAccount();
  const [parent, setParent] = useWorkspaceParent();

  const [name, setName] = useState('');
  const [picked, setPicked] = useState<string | null>(null);
  const [sync, setSync] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Set once the workspace exists but linking it failed: it's open, so the
  // only thing left is to say so.
  const [linkFailed, setLinkFailed] = useState(false);

  const signedIn = can.localFolders && !!account.server && !!account.username;
  // Sync is on by default once there's someone signed in to sync as.
  const [syncDefaulted, setSyncDefaulted] = useState(false);
  if (signedIn && !syncDefaulted) {
    setSyncDefaulted(true);
    setSync(true);
  }

  const trimmed = name.trim();
  const color = picked ?? defaultWorkspaceColor(trimmed);
  const syncing = can.localFolders && sync && signedIn;
  const ready = !!trimmed && !busy && (!can.localFolders || !!parent);

  const failLink = (message: string) => {
    setBusy(false);
    setLinkFailed(true);
    setError(`The workspace is open, but it couldn't start syncing: ${message}. Try again from Settings > Sync.`);
  };

  const create = async () => {
    if (!ready) return;
    setBusy(true);
    setError(null);

    const made = await commands.createWorkspace(parent ?? '', trimmed);
    if (made.status === 'error') {
      setBusy(false);
      return setError(made.error);
    }
    if (can.pickFolders && parent) await useKnownWorkspaces.getState().rememberParent(parent);
    await setWorkspace(made.data);
    // Only a picked color is stored; otherwise the name's is the same everywhere.
    if (picked) await useWorkspaceMeta.getState().setColor(made.data, picked);

    if (syncing) {
      const vault = await commands.syncCreateVault(account.server, trimmed, picked);
      if (vault.status === 'error') return failLink(vault.error);
      const linked = await commands.syncLink(account.server, vault.data.id, vault.data.name);
      if (linked.status === 'error') return failLink(linked.error);
      void useSync.getState().refresh();
      // The color reached the vault with it: settles the folder's copy.
      void useWorkspaceMeta.getState().load([made.data]);
    }
    setBusy(false);
    onDone();
  };

  return (
    <form
      className='contents'
      onSubmit={(event) => {
        event.preventDefault();
        void create();
      }}
    >
      <DialogHeader>
        <DialogTitle>New workspace</DialogTitle>
        <DialogDescription>
          {can.localFolders ? (
            <>
              An empty folder for new notes. To work on a vault that's already on the sync server,{' '}
              <button type='button' className='underline underline-offset-2' onClick={() => showDialog('import')}>
                import it from sync
              </button>{' '}
              instead.
            </>
          ) : (
            'A new, empty vault on this server.'
          )}
        </DialogDescription>
      </DialogHeader>

      <div className='grid gap-4 text-sm'>
        <div className='grid gap-2'>
          <Label htmlFor='new-workspace-name'>Name</Label>
          <div className='flex items-center gap-2'>
            <WorkspaceColorPicker
              color={color}
              picked={picked !== null}
              onChange={setPicked}
              trigger={
                <button
                  type='button'
                  title='Change color'
                  disabled={linkFailed}
                  className='rounded-[28%] outline-offset-2 focus-visible:outline-2 focus-visible:outline-ring'
                >
                  <WorkspaceIcon name={trimmed} color={color} size='lg' />
                </button>
              }
            />
            <Input
              id='new-workspace-name'
              value={name}
              autoFocus
              disabled={linkFailed}
              placeholder='Notes'
              onChange={(e) => setName(e.target.value)}
            />
          </div>
        </div>

        {can.pickFolders && <LocationField parent={parent} onParent={setParent} name={trimmed} disabled={linkFailed} />}

        {can.localFolders && (
          <div className='grid gap-2'>
            <div className='flex items-center justify-between gap-4'>
              <div className='grid gap-0.5'>
                <Label htmlFor='new-workspace-sync'>Sync with Solstice Sync</Label>
                {syncing && (
                  <p className='text-xs text-muted-foreground'>
                    Makes a new vault called {trimmed || 'this'} on the server.
                  </p>
                )}
              </div>
              <Switch id='new-workspace-sync' checked={sync} disabled={linkFailed} onCheckedChange={setSync} />
            </div>
            {sync && !signedIn && account.loaded && <SyncSignIn account={account} />}
          </div>
        )}

        {error && <p className='text-destructive select-text'>{error}</p>}
      </div>

      <DialogFooter>
        {linkFailed ? (
          <Button type='button' onClick={onDone}>
            Close
          </Button>
        ) : (
          <>
            <DialogClose render={<Button type='button' variant='outline'>Cancel</Button>} />
            <Button type='submit' disabled={!ready}>
              {busy ? 'Creating…' : 'Create'}
            </Button>
          </>
        )}
      </DialogFooter>
    </form>
  );
}
