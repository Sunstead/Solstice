import { useState } from 'react';

import { Button } from '@sunstead/ui/components/button';
import {
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@sunstead/ui/components/dialog';
import { Input } from '@sunstead/ui/components/input';
import { Label } from '@sunstead/ui/components/label';
import { Switch } from '@sunstead/ui/components/switch';
import { commands, isDesktop } from '@/lib/backend';
import { useWorkspace } from '@/hooks/use-workspace';
import { useKnownWorkspaces } from '@/lib/stores/known-workspaces';
import { useSync } from '@/lib/stores/sync';
import { useWorkspaceDialogs } from '@/lib/stores/workspace-dialogs';
import { useSyncAccount, useWorkspaceParent } from './helpers';
import { LocationField, SyncSignIn } from './shared';

/**
 * Makes a workspace, as opposed to opening a folder or importing one from
 * sync. On desktop: a name, where to put it, and whether to sync it (to a new
 * vault of the same name). On the web a workspace is a vault on the server,
 * so only the name.
 */
export function NewWorkspaceForm({ onDone }: { onDone: () => void }) {
  const setWorkspace = useWorkspace((s) => s.setWorkspace);
  const showDialog = useWorkspaceDialogs((s) => s.show);
  const account = useSyncAccount();
  const [parent, setParent] = useWorkspaceParent();

  const [name, setName] = useState('');
  const [sync, setSync] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Set once the workspace exists but linking it failed: it's open, so the
  // only thing left is to say so.
  const [linkFailed, setLinkFailed] = useState(false);

  const signedIn = isDesktop && !!account.server && !!account.username;
  // Sync is on by default once there's someone signed in to sync as.
  const [syncDefaulted, setSyncDefaulted] = useState(false);
  if (signedIn && !syncDefaulted) {
    setSyncDefaulted(true);
    setSync(true);
  }

  const trimmed = name.trim();
  const syncing = isDesktop && sync && signedIn;
  const ready = !!trimmed && !busy && (!isDesktop || !!parent);

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
    if (isDesktop && parent) await useKnownWorkspaces.getState().rememberParent(parent);
    await setWorkspace(made.data);

    if (syncing) {
      const vault = await commands.syncCreateVault(account.server, trimmed);
      if (vault.status === 'error') return failLink(vault.error);
      const linked = await commands.syncLink(account.server, vault.data.id, vault.data.name);
      if (linked.status === 'error') return failLink(linked.error);
      void useSync.getState().refresh();
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
          {isDesktop ? (
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
          <Input
            id='new-workspace-name'
            value={name}
            autoFocus
            disabled={linkFailed}
            placeholder='Notes'
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        {isDesktop && <LocationField parent={parent} onParent={setParent} name={trimmed} disabled={linkFailed} />}

        {isDesktop && (
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

        {error && <p className='text-destructive'>{error}</p>}
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
