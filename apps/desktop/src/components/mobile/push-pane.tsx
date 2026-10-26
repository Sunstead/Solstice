/* eslint-disable react-hooks/immutability -- moving DOM nodes (its own and the page behind) is this component's whole job */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';

import { pushSpring as spring } from '@/lib/push-spring';
import { kickSurfaces, useOverSurface } from '@/lib/surface-kicks';
import { motionEnabled } from '@/lib/tab-motion';
import { cn } from '@/lib/utils';

/**
 * A page pushed in takes VoiceOver's focus at its title, as UIKit moves it to
 * a pushed view controller's. Not where something in it already has focus.
 */
function announce(pane: HTMLElement) {
  if (pane.contains(document.activeElement)) return;
  const title = pane.querySelector<HTMLElement>('.solstice-push-page h1');
  if (!title) return;
  title.tabIndex = -1;
  title.focus({ preventScroll: true });
}

/** How far the page underneath slides left as one comes over it, as iOS does. */
const PARALLAX = 0.25;

/**
 * How much of the page behind and of the scrim, from their right edges, the
 * pane covers when `share` of it is in: clipped away, so nothing under the
 * pane is drawn. A native view (a PDF, a drawing) shows through the pushed
 * page from under the webview, and the file list drew over it.
 */
function covered(share: number, width: number): { behind: number; scrim: number } {
  return { behind: share * width * (1 - PARALLAX), scrim: share * width };
}

const clip = (right: number) => `inset(0 ${right}px 0 0)`;

/**
 * A page that slides in over another from the right, the way an iPhone app
 * goes deeper (a note over the file list, a settings section over You), and
 * goes back by its own Back button or a swipe right from anywhere on it.
 *
 * The swipe is the system's own scrolling, as a sheet's is (`touch-pane.tsx`):
 * the pane is a horizontal scroll view that snaps between the page in view
 * and a screen of nothing to its left, so the finger is followed on the
 * compositor, a flick carries on at its speed, and what scrolls vertically
 * inside keeps doing so (the system settles which way a drag is going).
 * Reaching the left is going back. The page behind and the scrim follow the
 * scroll position.
 *
 * Coming in and a Back button are the Web Animations API, on the same spring
 * as sheets, a little quicker (`--push-spring`). `behind` is the page it covers, which slides a little way left
 * under it.
 */
export function PushPane({
  open,
  onClose,
  behind,
  keepMounted = false,
  appear = false,
  className,
  children,
}: {
  open: boolean;
  /** The swipe back finished: the owner should now say it's closed. */
  onClose: () => void;
  behind?: RefObject<HTMLElement | null>;
  /** Kept mounted while closed (hidden and inert), so a note keeps its place. */
  keepMounted?: boolean;
  /** Mounted open, it slides in (a level of a stack pushed), rather than starting in place. */
  appear?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const pane = useRef<HTMLDivElement>(null);
  const scrim = useRef<HTMLDivElement>(null);
  const [present, setPresent] = useState(open);
  // Where the pane is headed, so the owner catching up after a swipe doesn't
  // animate it a second time.
  const heading = useRef<'open' | 'closed'>(open && !appear ? 'open' : 'closed');
  const running = useRef<Animation[]>([]);
  const edge = useOverSurface();
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  /**
   * How much of the way in it is, 1 open and 0 gone: the scrim and the page
   * behind follow, cut where the pane covers them. All the way in, they're
   * hidden, as UIKit takes a covered view out of the window.
   */
  const place = (share: number, width: number) => {
    const cut = covered(share, width);
    const away = share >= 1 ? 'hidden' : '';
    if (scrim.current) {
      scrim.current.style.opacity = String(share);
      scrim.current.style.clipPath = share > 0 ? clip(cut.scrim) : '';
      scrim.current.style.visibility = away || (share > 0 ? '' : 'hidden');
    }
    if (behind?.current) {
      behind.current.style.transform = share > 0 ? `translateX(${-PARALLAX * width * share}px)` : '';
      behind.current.style.clipPath = share > 0 ? clip(cut.behind) : '';
      behind.current.style.visibility = away;
    }
  };

  /** The page in view: scrolled past the empty screen to its left. */
  const rest = () => {
    const el = pane.current;
    if (el) el.scrollLeft = el.clientWidth;
  };

  const finish = (to: 'open' | 'closed') => {
    heading.current = to;
    const el = pane.current;
    if (!el) return;
    el.style.transform = to === 'open' ? '' : 'translateX(100%)';
    el.style.visibility = to === 'open' ? '' : 'hidden';
    place(to === 'open' ? 1 : 0, el.offsetWidth || window.innerWidth);
    if (to === 'open') rest();
    // A native view in it is shown or hidden with it.
    kickSurfaces();
    if (to === 'closed' && !keepMounted) setPresent(false);
  };

  /** Slides in or out, from where it is. */
  const settle = (to: 'open' | 'closed') => {
    heading.current = to;
    const el = pane.current;
    if (!el) return;
    for (const animation of running.current) animation.cancel();
    running.current = [];

    const width = el.offsetWidth || window.innerWidth;
    const start = to === 'open' ? width : 0;
    const end = to === 'open' ? 0 : width;
    el.style.visibility = '';
    if (scrim.current) scrim.current.style.visibility = '';
    if (behind?.current) behind.current.style.visibility = '';
    if (to === 'open') rest();
    if (!motionEnabled() || start === end) {
      finish(to);
      if (to === 'open') announce(el);
      return;
    }

    const { ms, easing } = spring();
    const timing = { duration: ms, easing };
    const share = (x: number) => 1 - x / width;
    const shift = (x: number) => `translateX(${-PARALLAX * width * share(x)}px)`;
    const animations = [
      el.animate([{ transform: `translateX(${start}px)` }, { transform: `translateX(${end}px)` }], timing),
    ];
    if (scrim.current) {
      const frame = (x: number) => ({ opacity: share(x), clipPath: clip(covered(share(x), width).scrim) });
      animations.push(scrim.current.animate([frame(start), frame(end)], timing));
    }
    if (behind?.current) {
      const frame = (x: number) => ({ transform: shift(x), clipPath: clip(covered(share(x), width).behind) });
      animations.push(behind.current.animate([frame(start), frame(end)], timing));
    }
    // A native view in the pane follows it while it moves.
    kickSurfaces();
    // Hold the end state until `finish` sets it for good.
    el.style.transform = `translateX(${end}px)`;
    if (scrim.current) scrim.current.style.opacity = String(1 - end / width);
    running.current = animations;
    void animations[0].finished.then(
      () => {
        if (heading.current === to) {
          finish(to);
          if (to === 'open') announce(el);
        }
        running.current = [];
      },
      () => {},
    );
  };

  // Opening mounts it; closing unmounts it once it's slid away (`finish`).
  if (open && !present) setPresent(true);
  const mounted = present || keepMounted;
  // Only a pane there from the first render starts in place; one mounted by
  // opening slides in.
  const first = useRef(mounted && !appear);
  useLayoutEffect(() => {
    if (!mounted) return;
    if (first.current) {
      first.current = false;
      finish(open ? 'open' : 'closed');
      return;
    }
    const to = open ? 'open' : 'closed';
    if (heading.current !== to) settle(to);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs on open/close only
  }, [open, mounted]);

  // The swipe: the scroll view's position is how far back it has gone.
  useEffect(() => {
    const el = pane.current;
    if (!el) return;
    const onScroll = () => {
      if (heading.current !== 'open' || running.current.length > 0) return;
      const width = el.clientWidth || 1;
      place(Math.min(Math.max(el.scrollLeft / width, 0), 1), width);
      // All the way back: it has already left, so nothing is left to play.
      if (el.scrollLeft <= 1) {
        finish('closed');
        onCloseRef.current();
      }
    };
    // A turned screen or a resized window keeps it on the page.
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => {
      if (heading.current === 'open') rest();
    });
    observer?.observe(el);
    el.addEventListener('scroll', onScroll, { passive: true });
    // A finger on a pane still sliding in catches it where it is, as iOS's do.
    const onTouch = () => {
      if (running.current.length === 0) return;
      for (const animation of running.current) animation.cancel();
      running.current = [];
      finish(heading.current);
    };
    el.addEventListener('touchstart', onTouch, { passive: true });
    return () => {
      observer?.disconnect();
      el.removeEventListener('scroll', onScroll);
      el.removeEventListener('touchstart', onTouch);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reads the latest through refs
  }, [mounted]);

  if (!mounted) return null;
  return (
    <>
      <div ref={scrim} className='pointer-events-none absolute inset-0 z-20 bg-black/25' aria-hidden />
      <div ref={pane} inert={!open} className='solstice-push'>
        <div className='solstice-push-dead' aria-hidden />
        <div className={cn('solstice-push-page', className)}>{children}</div>
        {/* The screen's left edge is going back, whatever is under it: a
            board or a wide table would take the swipe, and a native view's
            touches never reach the page at all. */}
        <div ref={edge} className='solstice-push-edge' aria-hidden />
      </div>
    </>
  );
}
