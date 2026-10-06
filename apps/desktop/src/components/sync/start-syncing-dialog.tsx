import { useState } from 'react';

import { type SyncLinkReport, type SyncVault } from '@/bindings';
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
import { commands } from '@/lib/backend';
import { useServerVaults } from '@/hooks/use-server-vaults';
import { useSync } from '@/lib/stores/sync';
import { linkSummary } from './link-summary';
import { VaultPicker } from './vault-picker';

/**
 * Starts syncing the open workspace: into a new vault (the default), or an
 * existing one, whose files it merges with. Opened from Settings > Sync.
 */
export function StartSyncingDialog({
  open,
  onOpenChange,
  server,
  workspace,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  server: string;
  workspace: string;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-md'>
        {open && <StartSyncingForm server={server} workspace={workspace} onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function StartSyncingForm({ server, workspace, onDone }: { server: string; workspace: string; onDone: () => void }) {
  const { vaults, error: loadError } = useServerVaults(server);
  const [choice, setChoice] = useState('new');
  const [name, setName] = useState(workspace);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<SyncLinkReport | null>(null);

  // A vault with the workspace's name is most likely the one it belongs to.
  const [guessed, setGuessed] = useState(false);
  if (vaults && !guessed) {
    setGuessed(true);
    const same = vaults.find((v) => v.name.toLowerCase() === workspace.toLowerCase());
    if (same) setChoice(same.id);
  }

  const start = async () => {
    setBusy(true);
    setError(null);
    let vault: SyncVault | undefined = vaults?.find((v) => v.id === choice);
    if (choice === 'new') {
      const created = await commands.syncCreateVault(server, name.trim());
      if (created.status === 'error') {
        setBusy(false);
        return setError(created.error);
      }
      vault = created.data;
    }
    if (!vault) return setBusy(false);
    const result = await commands.syncLink(server, vault.id, vault.name);
    setBusy(false);
    if (result.status === 'error') return setError(result.error);
    setReport(result.data);
    void useSync.getState().refresh();
  };

  if (report) {
    return (
      <>
        <DialogHeader>
          <DialogTitle>{workspace} is syncing</DialogTitle>
          <DialogDescription>{linkSummary(report)}</DialogDescription>
        </DialogHeader>
        {report.kept_both.length > 0 && (
          <div className='grid gap-1 text-sm'>
            <p>These files were different on each side, so both versions were kept:</p>
            <ul className='list-disc pl-5 text-muted-foreground'>
              {report.kept_both.map((path) => (
                <li key={path}>{path}</li>
              ))}
            </ul>
          </div>
        )}
        <DialogFooter>
          <Button type='button' onClick={onDone}>
            Done
          </Button>
        </DialogFooter>
      </>
    );
  }

  const ready = !!vaults && !busy && (choice !== 'new' || !!name.trim());
  return (
    <form
      className='contents'
      onSubmit={(event) => {
        event.preventDefault();
        if (ready) void start();
      }}
    >
      <DialogHeader>
        <DialogTitle>Sync {workspace}</DialogTitle>
        <DialogDescription>
          Choose the vault this workspace syncs with. A vault is the copy of your notes kept on Solstice Sync.
        </DialogDescription>
      </DialogHeader>
      <div className='grid gap-3 text-sm'>
        {vaults === null && !loadError && <p className='text-muted-foreground'>Loading vaults…</p>}
        {vaults && <VaultPicker vaults={vaults} choice={choice} onChoice={setChoice} name={name} onName={setName} />}
        {choice !== 'new' && (
          <p className='text-muted-foreground'>
            Files from both sides are combined. If a file exists in both places with different contents, both
            versions are kept.
          </p>
        )}
        {(error ?? loadError) && <p className='text-destructive'>{error ?? loadError}</p>}
      </div>
      <DialogFooter>
        <DialogClose render={<Button type='button' variant='outline'>Cancel</Button>} />
        <Button type='submit' disabled={!ready}>
          {busy ? 'Starting…' : 'Start syncing'}
        </Button>
      </DialogFooter>
    </form>
  );
}
