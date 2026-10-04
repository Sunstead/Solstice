import { AlertCircle, Cloud, CloudOff, Loader2, LogIn, RefreshCw } from 'lucide-react';

import type { SyncInfo } from '@/bindings';
import { Button } from '@sunstead/ui/components/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@sunstead/ui/components/tooltip';
import { useSettingsDialog } from '@/lib/stores/settings-dialog';
import { useSync } from '@/lib/stores/sync';

function describe(info: SyncInfo): string {
  switch (info.state) {
    case 'synced':
      return 'Up to date';
    case 'syncing':
      return 'Syncing';
    case 'connecting':
      return 'Connecting';
    case 'offline':
      return info.message ? `Offline: ${info.message}. Changes sync when it reconnects.` : 'Offline';
    case 'signed_out':
      return 'Signed out of the sync server';
    case 'relink':
      return 'Needs linking again';
    default:
      return info.state;
  }
}

/** One line of status, for the Sync settings pane. */
export function SyncStatusText({ info }: { info: SyncInfo }) {
  return (
    <p className='text-muted-foreground'>
      {describe(info)}
      {info.reviews > 0 && `, ${info.reviews} merge${info.reviews === 1 ? '' : 's'} to review`}.
    </p>
  );
}

/** The title bar's sync indicator; opens the Sync settings. Hidden when not synced. */
export function SyncIndicator() {
  const info = useSync((s) => s.info);
  const openSettings = useSettingsDialog((s) => s.openSettings);
  if (!info) return null;

  const Icon =
    info.state === 'synced'
      ? Cloud
      : info.state === 'syncing' || info.state === 'connecting'
        ? info.state === 'syncing'
          ? RefreshCw
          : Loader2
        : info.state === 'signed_out'
          ? LogIn
          : info.state === 'relink'
            ? AlertCircle
            : CloudOff;
  const attention = info.state === 'signed_out' || info.state === 'relink' || info.reviews > 0;

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant='ghost'
            size='icon-sm'
            aria-label={`Sync: ${describe(info)}`}
            onClick={() => openSettings('sync')}
            className={attention ? 'text-amber-600 dark:text-amber-400' : undefined}
          />
        }
      >
        <Icon className={info.state === 'connecting' ? 'animate-spin' : undefined} />
      </TooltipTrigger>
      <TooltipContent>
        Sync: {describe(info)}
        {info.reviews > 0 && ` (${info.reviews} to review)`}
      </TooltipContent>
    </Tooltip>
  );
}
