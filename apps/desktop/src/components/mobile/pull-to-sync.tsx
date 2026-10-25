import { useRef, useState, type ReactNode } from 'react';
import { RefreshCw } from 'lucide-react';

import { commands } from '@/lib/backend';
import { haptics } from '@/lib/haptics';
import { useSync } from '@/lib/stores/sync';
import { cn } from '@/lib/utils';

/** How far past the top a list is pulled before letting go syncs. */
const PULL = 64;

/**
 * Pull down at the top of a list to sync, in a linked workspace, as Mail
 * checks for mail. The pull is the system's own rubber band past the top of
 * whichever list scrolls inside (read from its negative `scrollTop`, on the
 * capture phase), so nothing here moves the list; the arrow sits behind it
 * and shows in the gap the pull opens.
 */
export function PullToSync({ children, className }: { children: ReactNode; className?: string }) {
  const linked = useSync((s) => s.info !== null);
  const [pull, setPull] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const touching = useRef(false);
  const armed = useRef(false);

  if (!linked) return <div className={className}>{children}</div>;

  const release = () => {
    touching.current = false;
    if (!armed.current) return;
    armed.current = false;
    setSyncing(true);
    void commands.syncReconnect().finally(() => window.setTimeout(() => setSyncing(false), 800));
  };

  return (
    <div
      className={cn('relative', className)}
      onTouchStart={() => (touching.current = true)}
      onTouchEnd={release}
      onTouchCancel={release}
      onScrollCapture={(event) => {
        const el = event.target as HTMLElement;
        const past = Math.max(0, -el.scrollTop);
        setPull(Math.min(past / PULL, 1));
        if (touching.current && past >= PULL && !armed.current) {
          armed.current = true;
          haptics.play('light');
        }
      }}
    >
      <div
        aria-hidden
        className='pointer-events-none absolute inset-x-0 top-2 flex justify-center text-muted-foreground'
        style={{ opacity: syncing ? 1 : pull }}
      >
        <RefreshCw
          className={cn('size-5', syncing && 'animate-spin')}
          style={syncing ? undefined : { rotate: `${pull * 270}deg` }}
        />
      </div>
      {children}
    </div>
  );
}
