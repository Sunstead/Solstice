import { useCallback, useEffect, useState } from 'react';
import { ChevronRight, RefreshCw } from 'lucide-react';

import { commands } from '@/lib/backend';
import { type SyncServerInfo } from '@/bindings';
import { Button } from '@sunstead/ui/components/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@sunstead/ui/components/collapsible';
import { Input } from '@sunstead/ui/components/input';
import { Label } from '@sunstead/ui/components/label';
import { useWorkspace } from '@/hooks/use-workspace';
import { setSetting, useSetting } from '@/lib/settings/store';
import { useAccount } from '@/lib/stores/account';
import { useSync } from '@/lib/stores/sync';
import { SyncStatusLine } from '@/components/sync/status';
import { StartSyncingDialog } from '@/components/sync/start-syncing-dialog';
import { UserAvatar } from '@/components/user-avatar';
import { host } from '@/components/workspace-dialogs/helpers';
import { Card, Heading } from './pane-parts';

type Outcome = { status: 'ok' } | { status: 'error'; error: string };

function folderName(path: string) {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? 'Notes';
}

/**
 * Solstice Sync on desktop: who's signed in, whether the open workspace
 * syncs, and (tucked away) which server. The sync itself runs in the Rust
 * side; see `docs/sync.md`.
 */
export function SyncPane() {
  const server = useSetting('sync.server');
  const [info, setInfo] = useState<SyncServerInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const username = useAccount((s) => s.username);
  const linked = useSync((s) => s.info);
  const workspace = useWorkspace((s) => s.path);

  const show = useCallback((result: { status: 'ok'; data: SyncServerInfo } | { status: 'error'; error: string }) => {
    setInfo(result.status === 'ok' ? result.data : null);
    setError(result.status === 'ok' ? null : result.error);
  }, []);
  const probe = useCallback(async () => {
    if (!server) return show({ status: 'error', error: 'No server is set.' });
    show(await commands.syncServerInfo(server));
    void useAccount.getState().refresh(server);
  }, [server, show]);

  useEffect(() => {
    let live = true;
    void Promise.resolve().then(() => {
      if (live) void probe();
    });
    return () => {
      live = false;
    };
  }, [probe]);

  const run = async (action: () => Promise<Outcome>) => {
    setBusy(true);
    setError(null);
    const result = await action();
    setBusy(false);
    await probe();
    if (result.status === 'error') setError(result.error);
    void useSync.getState().refresh();
  };

  const signedIn = !!info && (info.signed_in || info.auth === 'dev');

  return (
    <div className='flex flex-col gap-7'>
      <section>
        <Heading>Account</Heading>
        <Card>
          <div className='flex items-center gap-3'>
            <UserAvatar username={signedIn ? username : null} size='lg' />
            <div className='min-w-0 flex-1'>
              {signedIn ? (
                <>
                  <p>
                    Signed in as <span className='font-medium'>{username ?? '…'}</span>
                  </p>
                  <p className='truncate text-muted-foreground'>{host(server)}</p>
                </>
              ) : info ? (
                <p className='text-muted-foreground'>
                  Sign in to Solstice Sync to keep your notes up to date on all your devices and in your browser.
                </p>
              ) : error ? (
                <p className='text-muted-foreground'>
                  Can't reach {server ? host(server) : 'the server'}. Check your connection, or the server address
                  below.
                </p>
              ) : (
                <p className='text-muted-foreground'>Checking {host(server)}…</p>
              )}
            </div>
            {info?.auth === 'oidc' &&
              (info.signed_in ? (
                <Button variant='outline' size='sm' disabled={busy} onClick={() => void run(() => commands.syncSignOut(server))}>
                  Sign out
                </Button>
              ) : (
                <Button size='sm' disabled={busy} onClick={() => void run(() => commands.syncSignIn(server))}>
                  {busy ? 'Signing in…' : 'Sign in'}
                </Button>
              ))}
            {!info && error && (
              <Button variant='outline' size='sm' onClick={() => void probe()}>
                Try again
              </Button>
            )}
          </div>
          {info && error && <p className='text-destructive'>{error}</p>}
        </Card>
      </section>

      {workspace && (linked || signedIn) && (
        <section>
          <Heading>This workspace</Heading>
          {linked ? (
            <SyncedWorkspace workspace={folderName(workspace)} busy={busy} run={run} />
          ) : (
            <LocalWorkspace server={server} workspace={folderName(workspace)} />
          )}
        </section>
      )}

      <ServerSettings server={server} info={info} locked={linked !== null} unreachable={!info && !!error} />
    </div>
  );
}

function LocalWorkspace({ server, workspace }: { server: string; workspace: string }) {
  const [open, setOpen] = useState(false);
  return (
    <Card>
      <div className='flex items-center gap-3'>
        <p className='min-w-0 flex-1'>
          <span className='font-medium'>{workspace}</span> is only on this computer.
        </p>
        <Button size='sm' onClick={() => setOpen(true)}>
          Start syncing…
        </Button>
      </div>
      <StartSyncingDialog open={open} onOpenChange={setOpen} server={server} workspace={workspace} />
    </Card>
  );
}

function SyncedWorkspace({
  workspace,
  busy,
  run,
}: {
  workspace: string;
  busy: boolean;
  run: (action: () => Promise<Outcome>) => Promise<void>;
}) {
  const info = useSync((s) => s.info)!;
  const [confirm, setConfirm] = useState(false);
  const broken = info.state === 'deleted' || info.state === 'relink';

  const stop = (
    <Button
      size='sm'
      variant={confirm ? 'destructive' : broken ? 'default' : 'outline'}
      disabled={busy}
      onClick={() => (confirm || broken ? void run(() => commands.syncUnlink()) : setConfirm(true))}
    >
      {confirm ? 'Stop syncing' : broken ? 'Stop syncing' : 'Stop syncing…'}
    </Button>
  );

  return (
    <Card>
      <div className='flex flex-col gap-1'>
        <p>
          {broken ? 'Linked to' : 'Syncing with'} the vault <span className='font-medium'>{info.vault_name}</span>
        </p>
        <SyncStatusLine info={info} />
      </div>

      {info.state === 'deleted' && (
        <p className='text-muted-foreground'>
          Your files are still here. Stop syncing to keep them as a local workspace; you can then sync it again
          with a new vault.
        </p>
      )}
      {info.state === 'relink' && (
        <p className='text-muted-foreground'>
          The vault was rebuilt on the server. Stop syncing, then start again; your files stay here.
        </p>
      )}

      {confirm ? (
        <div className='flex flex-col gap-2 rounded-md bg-muted/50 p-3'>
          <p>
            Stop syncing {workspace}? Its files stay on this computer, and the vault stays on the server.
          </p>
          <div className='flex gap-2'>
            {stop}
            <Button size='sm' variant='ghost' onClick={() => setConfirm(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className='flex flex-wrap items-center gap-2'>
          {!broken && (
            <Button size='sm' variant='outline' disabled={busy} onClick={() => void run(() => commands.syncReconnect())}>
              <RefreshCw />
              Sync now
            </Button>
          )}
          {stop}
          <span className='ml-auto text-xs text-muted-foreground'>This computer appears as {info.device}</span>
        </div>
      )}
    </Card>
  );
}

function ServerSettings({
  server,
  info,
  locked,
  unreachable,
}: {
  server: string;
  info: SyncServerInfo | null;
  locked: boolean;
  unreachable: boolean;
}) {
  const [draft, setDraft] = useState(server);
  const [open, setOpen] = useState(!server || unreachable);
  const [prevUnreachable, setPrevUnreachable] = useState(unreachable);
  if (unreachable !== prevUnreachable) {
    setPrevUnreachable(unreachable);
    if (unreachable) setOpen(true);
  }

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className='group flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground'>
        <ChevronRight className='size-3.5 transition-transform group-data-[panel-open]:rotate-90' />
        Server settings
      </CollapsibleTrigger>
      <CollapsibleContent>
        <form
          className='flex flex-col gap-2 pt-3 text-sm'
          onSubmit={(e) => {
            e.preventDefault();
            setSetting('sync.server', draft.trim());
          }}
        >
          <Label htmlFor='sync-server'>Server address</Label>
          <div className='flex gap-2'>
            <Input
              id='sync-server'
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder='https://solstice.jupiter.sunstead.net'
              disabled={locked}
            />
            <Button type='submit' variant='outline' disabled={locked || !draft.trim() || draft.trim() === server}>
              Save
            </Button>
          </div>
          <p className='text-xs text-muted-foreground'>
            {locked
              ? 'Stop syncing this workspace to change servers.'
              : info
                ? `Solstice Sync ${info.version}${info.auth === 'dev' ? ', a development server (no sign-in)' : ''}.`
                : 'The Solstice Sync server your notes sync with.'}
          </p>
        </form>
      </CollapsibleContent>
    </Collapsible>
  );
}
