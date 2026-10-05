import { useCallback, useEffect, useState } from 'react';
import { Check, Copy, RefreshCw } from 'lucide-react';

import { commands } from '@/lib/backend';
import { type SyncLinkReport, type SyncServerInfo, type SyncVault } from '@/bindings';
import { Button } from '@sunstead/ui/components/button';
import { Input } from '@sunstead/ui/components/input';
import { useWorkspace } from '@/hooks/use-workspace';
import { setSetting, useSetting } from '@/lib/settings/store';
import { useSync } from '@/lib/stores/sync';
import { SyncStatusText } from '@/components/sync/status';
import { VaultPicker } from '@/components/sync/vault-picker';
import { useServerVaults } from '@/hooks/use-server-vaults';

function Heading({ children }: { children: React.ReactNode }) {
  return <h3 className='pb-1 text-xs font-medium text-muted-foreground'>{children}</h3>;
}

function folderName(path: string) {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? 'Notes';
}

/**
 * Solstice Sync: the server and sign-in, linking the open folder to a vault,
 * and a token for Atlas. The sync itself runs in the Rust side; see
 * `docs/sync.md`.
 */
export function SyncPane() {
  const server = useSetting('sync.server');
  const [draft, setDraft] = useState(server);
  const [info, setInfo] = useState<SyncServerInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const linked = useSync((s) => s.info);
  const workspace = useWorkspace((s) => s.path);

  const show = useCallback(
    (result: { status: 'ok'; data: SyncServerInfo } | { status: 'error'; error: string }) => {
      setInfo(result.status === 'ok' ? result.data : null);
      setError(result.status === 'ok' ? null : result.error);
    },
    [],
  );
  const probe = useCallback(async () => show(await commands.syncServerInfo(server)), [server, show]);

  useEffect(() => {
    let live = true;
    void commands.syncServerInfo(server).then((r) => live && show(r));
    return () => {
      live = false;
    };
  }, [server, show]);

  const run = async (action: () => Promise<{ status: 'ok' } | { status: 'error'; error: string }>) => {
    setBusy(true);
    setError(null);
    const result = await action();
    setBusy(false);
    if (result.status === 'error') setError(result.error);
    await probe();
    void useSync.getState().refresh();
  };

  return (
    <div className='flex flex-col gap-7'>
      <section className='flex flex-col gap-2'>
        <Heading>Server</Heading>
        <form
          className='flex gap-2'
          onSubmit={(e) => {
            e.preventDefault();
            setSetting('sync.server', draft.trim());
          }}
        >
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder='https://solstice.jupiter.sunstead.net'
            disabled={linked !== null}
          />
          {draft.trim() !== server && (
            <Button type='submit' variant='outline'>
              Use
            </Button>
          )}
        </form>
        {linked && (
          <p className='text-xs text-muted-foreground'>
            This folder syncs with {linked.server}. Unlink it to use another server.
          </p>
        )}
        <div className='flex flex-wrap items-center gap-2 text-sm'>
          {info ? (
            <>
              <span className='text-muted-foreground'>
                Solstice Sync {info.version}
                {info.auth === 'dev' ? ', a development server (no sign-in).' : '.'}
              </span>
              {info.auth === 'oidc' &&
                (info.signed_in ? (
                  <Button
                    size='sm'
                    variant='outline'
                    disabled={busy}
                    onClick={() => void run(() => commands.syncSignOut(server))}
                  >
                    Sign out
                  </Button>
                ) : (
                  <Button size='sm' disabled={busy} onClick={() => void run(() => commands.syncSignIn(server))}>
                    Sign in
                  </Button>
                ))}
            </>
          ) : (
            !error && <span className='text-muted-foreground'>Checking the server...</span>
          )}
        </div>
        {error && <p className='text-sm text-destructive'>{error}</p>}
      </section>

      <section className='flex flex-col gap-2'>
        <Heading>This folder</Heading>
        {!workspace ? (
          <p className='text-sm text-muted-foreground'>Open a folder to sync it.</p>
        ) : linked ? (
          <LinkedFolder busy={busy} run={run} />
        ) : info && info.signed_in ? (
          <LinkForm server={server} folder={folderName(workspace)} onLinked={() => void probe()} />
        ) : (
          <p className='text-sm text-muted-foreground'>Sign in to the server to link this folder.</p>
        )}
      </section>

      {info?.signed_in && <AtlasToken server={server} />}
    </div>
  );
}

function LinkedFolder({
  busy,
  run,
}: {
  busy: boolean;
  run: (action: () => Promise<{ status: 'ok' } | { status: 'error'; error: string }>) => Promise<void>;
}) {
  const info = useSync((s) => s.info)!;
  const [confirm, setConfirm] = useState(false);

  return (
    <div className='flex flex-col gap-2 text-sm'>
      <p>
        Synced with the vault <span className='font-medium'>{info.vault_name}</span> as{' '}
        <span className='font-medium'>{info.device}</span>.
      </p>
      <SyncStatusText info={info} />
      {info.state === 'deleted' && (
        <p className='text-muted-foreground'>
          The vault was deleted on the server, so this folder stopped syncing. Its files are still here: unlink it to
          keep it as a local workspace, or unlink it and link it to another vault.
        </p>
      )}
      {info.state === 'relink' && (
        <p className='text-muted-foreground'>
          The vault was rebuilt on the server. Unlink this folder, then link it again; its files stay.
        </p>
      )}
      <div className='flex flex-wrap gap-2'>
        <Button size='sm' variant='outline' disabled={busy} onClick={() => void run(() => commands.syncReconnect())}>
          <RefreshCw />
          Sync now
        </Button>
        {confirm ? (
          <>
            <Button size='sm' variant='destructive' disabled={busy} onClick={() => void run(() => commands.syncUnlink())}>
              Unlink: files stay here
            </Button>
            <Button size='sm' variant='ghost' onClick={() => setConfirm(false)}>
              Cancel
            </Button>
          </>
        ) : (
          <Button size='sm' variant='ghost' onClick={() => setConfirm(true)}>
            Unlink...
          </Button>
        )}
      </div>
    </div>
  );
}

function LinkForm({ server, folder, onLinked }: { server: string; folder: string; onLinked: () => void }) {
  const { vaults, error: loadError } = useServerVaults(server);
  const [choice, setChoice] = useState<string>('new');
  const [name, setName] = useState(folder);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<SyncLinkReport | null>(null);

  // A vault with the folder's name is most likely the one it belongs to.
  const [guessed, setGuessed] = useState(false);
  if (vaults && !guessed) {
    setGuessed(true);
    const same = vaults.find((v) => v.name.toLowerCase() === folder.toLowerCase());
    if (same) setChoice(same.id);
  }

  const link = async () => {
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
    if (!vault) {
      setBusy(false);
      return;
    }
    const result = await commands.syncLink(server, vault.id, vault.name);
    setBusy(false);
    if (result.status === 'error') return setError(result.error);
    setReport(result.data);
    onLinked();
    void useSync.getState().refresh();
  };

  if (report) {
    return (
      <div className='flex flex-col gap-1 text-sm'>
        <p className='flex items-center gap-1.5'>
          <Check className='size-4 text-emerald-600' /> Linked.
        </p>
        <p className='text-muted-foreground'>
          {report.same} already matched, {report.downloaded} copied here, {report.uploaded} added to the vault.
        </p>
        {report.kept_both.length > 0 && (
          <p className='text-muted-foreground'>
            Some files differed, so this folder's versions were kept beside the vault's:{' '}
            {report.kept_both.join(', ')}.
          </p>
        )}
      </div>
    );
  }

  return (
    <div className='flex flex-col gap-2 text-sm'>
      <p className='text-muted-foreground'>
        Link this folder to a vault on the server. Files on one side are copied to the other; where both
        have a file that differs, this folder's version is kept beside the vault's.
      </p>
      {vaults === null && !error && !loadError && <p className='text-muted-foreground'>Loading vaults...</p>}
      {vaults && <VaultPicker vaults={vaults} choice={choice} onChoice={setChoice} name={name} onName={setName} />}
      <div>
        <Button size='sm' disabled={busy || !vaults || (choice === 'new' && !name.trim())} onClick={() => void link()}>
          {busy ? 'Linking...' : 'Link this folder'}
        </Button>
      </div>
      {(error ?? loadError) && <p className='text-destructive'>{error ?? loadError}</p>}
    </div>
  );
}

function AtlasToken({ server }: { server: string }) {
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const create = async () => {
    setError(null);
    const result = await commands.syncCreateToken(server, 'Atlas');
    if (result.status === 'ok') setToken(result.data);
    else setError(result.error);
  };

  return (
    <section className='flex flex-col gap-2 text-sm'>
      <Heading>Atlas</Heading>
      <p className='text-muted-foreground'>
        Atlas can search these notes, and save new ones into a vault, with a token from here. A token can only
        list vaults and create notes.
      </p>
      {token ? (
        <div className='flex flex-col gap-1'>
          <div className='flex gap-2'>
            <Input readOnly value={token} className='font-mono text-xs' />
            <Button
              size='sm'
              variant='outline'
              onClick={() => {
                void navigator.clipboard.writeText(token);
                setCopied(true);
              }}
            >
              {copied ? <Check /> : <Copy />}
              {copied ? 'Copied' : 'Copy'}
            </Button>
          </div>
          <p className='text-xs text-muted-foreground'>
            Paste it into Atlas's Solstice connection now: it isn't shown again.
          </p>
        </div>
      ) : (
        <div>
          <Button size='sm' variant='outline' onClick={() => void create()}>
            Create a token for Atlas
          </Button>
        </div>
      )}
      {error && <p className='text-destructive'>{error}</p>}
    </section>
  );
}
