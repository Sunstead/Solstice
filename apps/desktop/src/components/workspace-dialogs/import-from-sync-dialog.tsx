import { useState } from 'react';
import { Check, Cloud } from 'lucide-react';

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
import { commands } from '@/lib/backend';
import { type SyncLinkReport, type SyncVault } from '@/bindings';
import { useWorkspace } from '@/hooks/use-workspace';
import { useServerVaults } from '@/hooks/use-server-vaults';
import { useKnownWorkspaces } from '@/lib/stores/known-workspaces';
import { useSync } from '@/lib/stores/sync';
import { cn } from '@/lib/utils';
import { host, useSyncAccount, useWorkspaceParent } from './helpers';
import { can, deviceNoun } from '@/lib/backend/platform';
import { LocationField, SyncSignIn } from './shared';

/**
 * Brings a vault from the sync server onto this computer: a new folder, linked
 * to the vault, which downloads into it. Desktop only; on the web every vault
 * is already a workspace.
 */
export function ImportFromSyncForm({ onDone }: { onDone: () => void }) {
  const setWorkspace = useWorkspace((s) => s.setWorkspace);
  const account = useSyncAccount();
  const signedIn = !!account.server && !!account.username;
  const { vaults, error: loadError } = useServerVaults(account.server, signedIn);
  const [parent, setParent] = useWorkspaceParent();

  const [vault, setVault] = useState<SyncVault | null>(null);
  const [folder, setFolder] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<SyncLinkReport | null>(null);

  const choose = (v: SyncVault) => {
    // The folder follows the vault's name until it's edited.
    if (!vault || folder === vault.name) setFolder(v.name);
    setVault(v);
  };

  const trimmed = folder.trim();
  const ready = !!vault && !!trimmed && !!parent && !busy;

  const importVault = async () => {
    if (!ready || !vault || !parent) return;
    setBusy(true);
    setError(null);
    const made = await commands.createWorkspace(parent, trimmed);
    if (made.status === 'error') {
      setBusy(false);
      return setError(made.error);
    }
    if (can.pickFolders) await useKnownWorkspaces.getState().rememberParent(parent);
    await setWorkspace(made.data);
    const linked = await commands.syncLink(account.server, vault.id, vault.name);
    setBusy(false);
    if (linked.status === 'error') {
      return setError(`The folder is open, but downloading ${vault.name} failed: ${linked.error}. Try again from Settings > Sync.`);
    }
    void useSync.getState().refresh();
    setReport(linked.data);
  };

  if (report && vault) {
    return (
      <>
        <DialogHeader>
          <DialogTitle>Imported {vault.name}</DialogTitle>
          <DialogDescription>
            {report.downloaded === 1 ? '1 file' : `${report.downloaded} files`} downloaded. It keeps syncing while
            it's open.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type='button' onClick={onDone}>
            Done
          </Button>
        </DialogFooter>
      </>
    );
  }

  return (
    <form
      className='contents'
      onSubmit={(event) => {
        event.preventDefault();
        void importVault();
      }}
    >
      <DialogHeader>
        <DialogTitle>Import from sync</DialogTitle>
        <DialogDescription>
          Download a vault from {account.server ? host(account.server) : 'the sync server'} into a new folder on this{' '}
          {deviceNoun}. It stays linked, so changes sync both ways.
        </DialogDescription>
      </DialogHeader>

      <div className='grid gap-4 text-sm'>
        {!signedIn && account.loaded && <SyncSignIn account={account} />}

        {signedIn && (
          <div className='grid gap-2'>
            <Label>Vault</Label>
            {vaults === null && !loadError && <p className='text-muted-foreground'>Loading vaults…</p>}
            {loadError && <p className='text-destructive'>{loadError}</p>}
            {vaults?.length === 0 && (
              <p className='text-muted-foreground'>There are no vaults on the server yet. Make a new workspace instead.</p>
            )}
            {vaults && vaults.length > 0 && (
              <div role='radiogroup' className='grid max-h-56 gap-1 overflow-y-auto rounded-md border p-1'>
                {vaults.map((v) => (
                  <button
                    key={v.id}
                    type='button'
                    role='radio'
                    aria-checked={vault?.id === v.id}
                    onClick={() => choose(v)}
                    className={cn(
                      'flex items-center gap-2 rounded-sm px-2 py-1.5 text-left hover:bg-muted',
                      vault?.id === v.id && 'bg-muted',
                    )}
                  >
                    <Cloud className='size-4 text-muted-foreground' />
                    <span className='flex-1 truncate'>{v.name}</span>
                    {vault?.id === v.id && <Check className='size-4' />}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {signedIn && vault && (
          <>
            <div className='grid gap-2'>
              <Label htmlFor='import-folder'>Folder name</Label>
              <Input id='import-folder' value={folder} onChange={(e) => setFolder(e.target.value)} />
            </div>
            {can.pickFolders && <LocationField parent={parent} onParent={setParent} name={trimmed} />}
          </>
        )}

        {error && <p className='text-destructive'>{error}</p>}
      </div>

      <DialogFooter>
        <DialogClose render={<Button type='button' variant='outline'>Cancel</Button>} />
        <Button type='submit' disabled={!ready}>
          {busy ? 'Importing…' : 'Import'}
        </Button>
      </DialogFooter>
    </form>
  );
}
