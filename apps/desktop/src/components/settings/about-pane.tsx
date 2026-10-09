import { Button } from '@sunstead/ui/components/button';
import { can } from '@/lib/backend/platform';
import { useUpdates, type UpdateStatus } from '@/lib/stores/updates';
import { useAppVersion } from '@/hooks/use-app-version';
import { Card, Heading } from './pane-parts';
import { SettingsPane } from './settings-pane';

function describe(status: UpdateStatus, version: string | undefined, lastChecked: Date | null) {
  switch (status.state) {
    case 'checking':
      return 'Checking…';
    case 'installing':
      return `Installing ${version}…`;
    case 'available':
      return `Solstice ${version} is available.`;
    case 'error':
      return status.message;
    default:
      return lastChecked
        ? `Up to date. Last checked ${lastChecked.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.`
        : null;
  }
}

/** The app's version, and on a computer, its updates. */
export function AboutPane() {
  const version = useAppVersion();
  const status = useUpdates((s) => s.status);
  const update = useUpdates((s) => s.update);
  const lastChecked = useUpdates((s) => s.lastChecked);
  const line = describe(status, update?.version, lastChecked);
  const busy = status.state === 'checking' || status.state === 'installing';

  return (
    <div className='flex flex-col gap-7'>
      <section>
        <Heading>Solstice</Heading>
        <Card>
          <div className='flex items-center justify-between gap-4'>
            <div className='flex flex-col gap-0.5'>
              <p>Version {version ?? '…'}</p>
              {can.updates && line && (
                <p className={status.state === 'error' ? 'text-xs text-warning' : 'text-xs text-muted-foreground'}>
                  {line}
                </p>
              )}
            </div>
            {can.updates &&
              (update ? (
                <Button onClick={() => useUpdates.getState().openDialog()} disabled={busy}>
                  Update…
                </Button>
              ) : (
                <Button
                  variant='outline'
                  onClick={() => void useUpdates.getState().check()}
                  disabled={busy}
                >
                  Check for updates
                </Button>
              ))}
          </div>
        </Card>
      </section>
      {can.updates && <SettingsPane section='about' />}
    </div>
  );
}
