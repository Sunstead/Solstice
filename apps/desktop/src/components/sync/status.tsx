import { AlertCircle, Cloud, CloudOff, Loader2, LogIn, RefreshCw, type LucideIcon } from 'lucide-react';

import type { SyncInfo } from '@/bindings';
import { Button } from '@sunstead/ui/components/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@sunstead/ui/components/tooltip';
import { useSettingsDialog } from '@/lib/stores/settings-dialog';
import { useSync } from '@/lib/stores/sync';
import { cn } from '@/lib/utils';
import { describe, needsAttention } from './describe';

const ICONS: Record<string, LucideIcon> = {
  synced: Cloud,
  syncing: RefreshCw,
  connecting: Loader2,
  signed_out: LogIn,
  relink: AlertCircle,
  deleted: AlertCircle,
};

function SyncIcon({ info, className }: { info: SyncInfo; className?: string }) {
  const Icon = ICONS[info.state] ?? CloudOff;
  return <Icon className={cn(className, info.state === 'connecting' && 'animate-spin')} />;
}

function reviewsText(reviews: number) {
  return `${reviews} merge${reviews === 1 ? '' : 's'} to review`;
}

/** The state as an icon and a line, for the settings panes. */
export function SyncStatusLine({ info }: { info: SyncInfo }) {
  const attention = needsAttention(info);
  return (
    <div className='flex flex-col gap-0.5'>
      <p className={cn('flex items-center gap-1.5 text-sm', attention ? 'text-warning' : 'text-muted-foreground')}>
        <SyncIcon info={info} className='size-4 shrink-0' />
        {describe(info)}
        {info.reviews > 0 && <span>· {reviewsText(info.reviews)}</span>}
      </p>
      {info.state === 'offline' && info.message && (
        <p className='pl-5.5 text-xs text-muted-foreground'>{info.message}</p>
      )}
    </div>
  );
}

/** The title bar's sync indicator; opens the Sync settings. Hidden when not synced. */
export function SyncIndicator() {
  const info = useSync((s) => s.info);
  const openSettings = useSettingsDialog((s) => s.openSettings);
  if (!info) return null;

  const label = `${describe(info)}${info.reviews > 0 ? ` (${reviewsText(info.reviews)})` : ''}`;

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant='ghost'
            size='icon-sm'
            aria-label={`Sync: ${label}`}
            onClick={() => openSettings('sync')}
            className={needsAttention(info) ? 'text-warning' : undefined}
          />
        }
      >
        <SyncIcon info={info} />
      </TooltipTrigger>
      <TooltipContent>Sync: {label}</TooltipContent>
    </Tooltip>
  );
}
