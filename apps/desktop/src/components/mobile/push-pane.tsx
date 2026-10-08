/* eslint-disable react-hooks/immutability -- moving DOM nodes (its own and the page behind) is this component's whole job */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';

import { motionEnabled } from '@/lib/tab-motion';
import { cn } from '@/lib/utils';

const DURATION = 320;
const EASE = 'cubic-bezier(0.2, 0, 0, 1)';
/** How far the page underneath slides left as one comes over it, as iOS does. */
const PARALLAX = 0.25;
/** How wide the strip at the left edge is that a swipe back starts on. */
const EDGE = 20;

/**
 * A page that slides in over another from the right, the way an iPhone app
 * goes deeper (a note over the file list, a settings section over You), and
 * goes back by its own Back button or a swipe from its left edge.
 *
 * Motion is the Web Animations API, from wherever the page is now (a swipe
 * lets go anywhere) to where it's going. `behind` is the page it covers,
 * which slides a little way left under it.
 */
export function PushPane({
  open,
  onClose,
  behind,
  keepMounted = false,
  edgeTop = 0,
  className,
  children,
}: {
  open: boolean;
  /** The swipe back finished: the owner should now say it's closed. */
  onClose: () => void;
  behind?: RefObject<HTMLElement | null>;
  /** Kept mounted while closed (hidden and inert), so a note keeps its place. */
  keepMounted?: boolean;
  /** Where the edge strip starts, below a header whose Back button it would cover. */
  edgeTop?: number;
  className?: string;
  children: ReactNode;
}) {
  const pane = useRef<HTMLDivElement>(null);
  const scrim = useRef<HTMLDivElement>(null);
  const [present, setPresent] = useState(open);
  // Where the pane is headed, so the owner catching up after a swipe doesn't
  // animate it a second time.
  const heading = useRef<'open' | 'closed'>(open ? 'open' : 'closed');
  const running = useRef<Animation[]>([]);

  const place = (x: number, width: number) => {
    const progress = 1 - x / width;
    if (pane.current) pane.current.style.transform = `translateX(${x}px)`;
    if (scrim.current) scrim.current.style.opacity = String(progress);
    if (behind?.current) behind.current.style.transform = `translateX(${-PARALLAX * width * progress}px)`;
  };

  const finish = (to: 'open' | 'closed') => {
    const el = pane.current;
    if (!el) return;
    el.style.transform = to === 'open' ? '' : 'translateX(100%)';
    el.style.visibility = to === 'open' ? '' : 'hidden';
    if (scrim.current) {
      scrim.current.style.opacity = to === 'open' ? '1' : '0';
      scrim.current.style.visibility = to === 'open' ? '' : 'hidden';
    }
    if (behind?.current) behind.current.style.transform = '';
    if (to === 'closed' && !keepMounted) setPresent(false);
  };

  /** Animates from `fromX` (pixels from the left) to open or closed. */
  const settle = (to: 'open' | 'closed', fromX?: number) => {
    heading.current = to;
    const el = pane.current;
    if (!el) return;
    for (const animation of running.current) animation.cancel();
    running.current = [];

    const width = el.offsetWidth || window.innerWidth;
    const start = fromX ?? (to === 'open' ? width : 0);
    const end = to === 'open' ? 0 : width;
    el.style.visibility = '';
    if (scrim.current) scrim.current.style.visibility = '';
    if (!motionEnabled() || start === end) {
      finish(to);
      return;
    }

    const duration = Math.max(140, (DURATION * Math.abs(end - start)) / width);
    const timing = { duration, easing: EASE };
    const shift = (x: number) => `translateX(${-PARALLAX * width * (1 - x / width)}px)`;
    const animations = [
      el.animate([{ transform: `translateX(${start}px)` }, { transform: `translateX(${end}px)` }], timing),
    ];
    if (scrim.current) {
      animations.push(scrim.current.animate([{ opacity: 1 - start / width }, { opacity: 1 - end / width }], timing));
    }
    if (behind?.current) {
      animations.push(behind.current.animate([{ transform: shift(start) }, { transform: shift(end) }], timing));
    }
    // Hold the end state until `finish` sets it for good.
    place(end, width);
    running.current = animations;
    void animations[0].finished.then(
      () => {
        if (heading.current === to) finish(to);
        running.current = [];
      },
      () => {},
    );
  };

  // The owner opened or closed it.
  useEffect(() => {
    if (open) setPresent(true);
  }, [open]);
  const mounted = present || keepMounted;
  const first = useRef(true);
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

  // A swipe from the left edge drags the pane back.
  const drag = useRef<{ id: number; x: number; y: number; dx: number; t: number; v: number; moving: boolean } | null>(
    null,
  );
  const onPointerDown = (e: React.PointerEvent) => {
    drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, dx: 0, t: e.timeStamp, v: 0, moving: false };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    const el = pane.current;
    if (!d || d.id !== e.pointerId || !el) return;
    const dx = Math.max(0, e.clientX - d.x);
    if (!d.moving) {
      if (Math.abs(e.clientY - d.y) > dx) {
        drag.current = null;
        return;
      }
      if (dx < 8) return;
      d.moving = true;
      for (const animation of running.current) animation.cancel();
      running.current = [];
    }
    const dt = Math.max(1, e.timeStamp - d.t);
    d.v = (dx - d.dx) / dt;
    d.dx = dx;
    d.t = e.timeStamp;
    place(dx, el.offsetWidth);
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    const el = pane.current;
    if (!d || d.id !== e.pointerId || !d.moving || !el) return;
    const back = d.dx > el.offsetWidth * 0.4 || d.v > 0.5;
    settle(back ? 'closed' : 'open', d.dx);
    if (back) onClose();
  };

  if (!mounted) return null;
  return (
    <>
      <div ref={scrim} className='pointer-events-none absolute inset-0 z-20 bg-black/25' aria-hidden />
      <div
        ref={pane}
        inert={!open}
        className={cn('absolute inset-0 z-20 flex flex-col bg-background shadow-[-8px_0_24px_rgb(0_0_0/0.12)]', className)}
      >
        {children}
        <div
          aria-hidden
          className='absolute bottom-0 left-0 z-10 touch-none'
          style={{ top: edgeTop, width: EDGE }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        />
      </div>
    </>
  );
}
