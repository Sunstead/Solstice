import { useRef, useState, type ReactNode } from 'react';
import { RefreshCw } from 'lucide-react';

import { commands } from '@/lib/backend';
import { haptics } from '@/lib/haptics';
import { useSync } from '@/lib/stores/sync';
import { cn } from '@/lib/utils';

/**
 * How far past the top a list is pulled (in the rubber band's own points,
 * which lag the finger: this is about twice as far for the finger) before
 * letting go syncs.
 */
const PULL = 80;
/** The first of the pull that shows nothing: a bounce, or a scroll that overshot. */
const SLACK = 16;
/**
 * How far back from `PULL` it must be pushed to call it off, so a finger
 * easing off as it lifts (or the bounce starting before the lift is heard)
 * doesn't.
 */
const CANCEL = 32;

/**
 * Pull down at the top of a list to sync, in a linked workspace, as Mail
 * checks for mail. The pull is the system's own rubber band past the top of
 * whichever list scrolls inside (read from its negative `scrollTop`, on the
 * capture phase), so nothing here moves the list; the arrow sits behind it
 * and shows in the gap the pull opens.
 *
 * Only a finger's pull counts (a flick's bounce at the top shows nothing),
 * and it syncs on letting go all the way down: pushed back up first, it's
 * called off.
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
    setPull(0);
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
        if (!touching.current) return;
        const el = event.target as HTMLElement;
        const past = Math.max(0, -el.scrollTop);
        if (!armed.current && past >= PULL) {
          armed.current = true;
          haptics.play('light');
        } else if (armed.current && past < PULL - CANCEL) {
          armed.current = false;
        }
        setPull(armed.current ? 1 : Math.min(Math.max(past - SLACK, 0) / (PULL - SLACK), 1));
      }}
    >
      <div
        aria-hidden
        className='pointer-events-none absolute inset-x-0 top-2 flex justify-center text-muted-foreground'
        style={{ opacity: syncing ? 1 : pull }}
      >
        <RefreshCw
          className={cn('size-5', syncing && 'animate-spin', !syncing && pull >= 1 && 'text-foreground')}
          style={syncing ? undefined : { rotate: `${pull * 270}deg` }}
        />
      </div>
      {children}
    </div>
  );
}
