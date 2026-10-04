import { useEffect, useState } from 'react';

import { Button } from '@sunstead/ui/components/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@sunstead/ui/components/dialog';
import { Input } from '@sunstead/ui/components/input';
import { Label } from '@sunstead/ui/components/label';
import { Switch } from '@sunstead/ui/components/switch';
import { commands, isDesktop } from '@/lib/backend';
import { open as pickFolder } from '@/lib/backend/shell';
import { type SyncVault } from '@/bindings';
import { useWorkspace } from '@/hooks/use-workspace';
import { useAccount } from '@/lib/stores/account';
import { useKnownWorkspaces } from '@/lib/stores/known-workspaces';
import { useNewWorkspaceDialog } from '@/lib/stores/new-workspace-dialog';
import { useSync } from '@/lib/stores/sync';
import { useSetting } from '@/lib/settings/store';
import { VaultPicker } from './sync/vault-picker';
import { useServerVaults } from '@/hooks/use-server-vaults';

function host(server: string) {
  try {
    return new URL(server).host;
  } catch {
    return server;
  }
}

function join(parent: string, name: string) {
  const sep = parent.includes('\\') ? '\\' : '/';
  return parent.endsWith(sep) ? `${parent}${name}` : `${parent}${sep}${name}`;
}

/**
 * Makes a workspace, as opposed to opening a folder as one. On desktop: a
 * name, where to put it, and whether it syncs (to a new vault, or an existing
 * one, which then downloads into it). On the web a workspace is a vault on
 * the server, so only the name.
 */
export function NewWorkspaceDialog() {
  const open = useNewWorkspaceDialog((s) => s.open);
  const setOpen = useNewWorkspaceDialog((s) => s.setOpen);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className='sm:max-w-lg'>
        {open && <NewWorkspaceForm onDone={() => setOpen(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function NewWorkspaceForm({ onDone }: { onDone: () => void }) {
  const server = useSetting('sync.server');
  const username = useAccount((s) => s.username);
  const refreshAccount = useAccount((s) => s.refresh);
  const setWorkspace = useWorkspace((s) => s.setWorkspace);

  const [name, setName] = useState('');
  const [parent, setParent] = useState<string | null>(null);
  const [sync, setSync] = useState(false);
  const [choice, setChoice] = useState('new');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Set once the workspace exists but linking it failed: it's open, so the
  // only thing left is to say so.
  const [linkFailed, setLinkFailed] = useState(false);

  const signedIn = isDesktop && !!server && !!username;
  const { vaults, error: vaultError } = useServerVaults(server, sync && signedIn);

  useEffect(() => {
    if (!isDesktop) return;
    void refreshAccount(server);
    void (async () => {
      const remembered = await useKnownWorkspaces.getState().lastParent();
      setParent(remembered ?? (await commands.defaultWorkspaceParent()));
    })();
  }, [server, refreshAccount]);

  // Sync is on by default once there's someone signed in to sync as.
  const [syncDefaulted, setSyncDefaulted] = useState(false);
  if (signedIn && !syncDefaulted) {
    setSyncDefaulted(true);
    setSync(true);
  }

  const chooseVault = (id: string) => {
    setChoice(id);
    const vault = vaults?.find((v) => v.id === id);
    if (vault) setName(vault.name);
  };

  const browse = async () => {
    const picked = await pickFolder({ directory: true, defaultPath: parent ?? undefined });
    if (typeof picked === 'string') setParent(picked);
  };

  const signIn = async () => {
    setBusy(true);
    setError(null);
    const result = await commands.syncSignIn(server);
    if (result.status === 'error') setError(result.error);
    await refreshAccount(server);
    setBusy(false);
  };

  const trimmed = name.trim();
  const syncing = isDesktop && sync && signedIn;
  const ready =
    !!trimmed && !busy && (!isDesktop || !!parent) && (!syncing || choice === 'new' || !!vaults);

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
      let vault: SyncVault | undefined = vaults?.find((v) => v.id === choice);
      if (choice === 'new') {
        const created = await commands.syncCreateVault(server, trimmed);
        if (created.status === 'error') return failLink(created.error);
        vault = created.data;
      }
      if (vault) {
        const linked = await commands.syncLink(server, vault.id, vault.name);
        if (linked.status === 'error') return failLink(linked.error);
        void useSync.getState().refresh();
      }
    }
    setBusy(false);
    onDone();
  };

  const failLink = (message: string) => {
    setBusy(false);
    setLinkFailed(true);
    setError(`The workspace is open, but it couldn't be linked to sync: ${message}. Try again from Settings > Sync.`);
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
          {isDesktop
            ? 'A new folder for your notes. To use a folder you already have, open it as a workspace instead.'
            : 'A new vault on this server, for your notes.'}
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

        {isDesktop && (
          <div className='grid gap-2'>
            <Label>Location</Label>
            <div className='flex items-center gap-2'>
              <p className='min-w-0 flex-1 truncate text-muted-foreground' title={parent ?? undefined}>
                {parent ? join(parent, trimmed || '…') : 'Choose a folder'}
              </p>
              <Button type='button' variant='outline' size='sm' disabled={linkFailed} onClick={() => void browse()}>
                Browse…
              </Button>
            </div>
          </div>
        )}

        {isDesktop && (
          <div className='grid gap-2'>
            <div className='flex items-center justify-between gap-4'>
              <Label htmlFor='new-workspace-sync'>Sync with Solstice Sync</Label>
              <Switch
                id='new-workspace-sync'
                checked={sync}
                disabled={linkFailed}
                onCheckedChange={(on) => setSync(on)}
              />
            </div>
            {sync && !server && (
              <p className='text-muted-foreground'>Set a sync server in Settings &gt; Sync first.</p>
            )}
            {sync && server && !username && (
              <div className='flex items-center justify-between gap-4'>
                <p className='text-muted-foreground'>Sign in to {host(server)} to sync.</p>
                <Button type='button' variant='outline' size='sm' disabled={busy} onClick={() => void signIn()}>
                  Sign in
                </Button>
              </div>
            )}
            {syncing && vaults === null && !vaultError && <p className='text-muted-foreground'>Loading vaults…</p>}
            {syncing && vaults && (
              <>
                <p className='text-muted-foreground'>
                  Sync it to a new vault, or to one already on the server, which is downloaded into it.
                </p>
                <VaultPicker vaults={vaults} choice={choice} onChoice={chooseVault} name={trimmed} />
              </>
            )}
            {syncing && vaultError && <p className='text-destructive'>{vaultError}</p>}
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
