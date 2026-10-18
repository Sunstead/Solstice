import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Dialog as DialogPrimitive } from '@base-ui/react/dialog';

import { cn } from '@/lib/utils';

/**
 * Where a dialog or bottom sheet sits on a touch screen: a full-screen,
 * transparent scroll view with the card in it. Pulling the card down is then
 * scrolling the view, so the system does what it does for every scrolling
 * thing: the finger is followed on the compositor, not through a JS touch
 * handler (a WKWebView runs those at 60 Hz, a frame or two behind), and a
 * flick carries on at the speed it was let go at, snaps to open or closed
 * and rubber-bands past the top, as in UIKit. Scroll snapping is the
 * decision: two points, the card in view and the card gone.
 *
 *   ┌ dead ─ a screen of nothing: the card lands here when pulled away
 *   └ frame ─ a screen with the card in it (centred, or at the bottom)
 *
 * It rests on the frame; reaching the top of the dead screen is the swipe
 * away, and closes the pane (`usePaneScroll`). The scroll view is the
 * popup (`styles/app.css`, `.solstice-pane`); the card keeps the
 * `dialog-content` / `sheet-content` slot, so it is what's styled.
 */
export type PaneAlign = 'center' | 'end' | 'top';

/** How far from the top is "gone": the dead screen has come all the way down. */
const GONE = 1;

function usePaneScroll(inside: HTMLDivElement | null, close: React.RefObject<HTMLButtonElement | null>) {
  useLayoutEffect(() => {
    // The popup's own ref never reaches us (its component merges it away), so
    // the pane is found from the frame inside it.
    const el = inside?.parentElement;
    if (!el) return;
    const overlay = el.parentElement?.querySelector<HTMLElement>(':scope > [data-slot$="-overlay"]') ?? null;
    let ready = false;
    let closing = false;
    let share = 1;

    // At rest before the first paint: the card in view. The popup is still
    // taking its place as it mounts, and a scroll position set that early
    // doesn't always hold, so it is kept at rest for a second, or until a finger touches it.
    let touched = false;
    let pinning = 0;
    const settled = performance.now() + 1000;
    const pin = () => {
      if (touched || closing || performance.now() > settled) return;
      if (Math.abs(el.scrollTop - el.clientHeight) > 0.5) el.scrollTop = el.clientHeight;
      pinning = requestAnimationFrame(pin);
    };
    pin();
    const touch = () => {
      touched = true;
      cancelAnimationFrame(pinning);
    };
    el.addEventListener('touchstart', touch, { passive: true, once: true });

    const refuse = () => {
      closing = false;
      delete el.dataset.swiped;
      el.scrollTo({ top: el.clientHeight, behavior: 'smooth' });
    };

    const onScroll = () => {
      const height = el.clientHeight || 1;
      share = Math.min(Math.max(el.scrollTop / height, 0), 1);
      // The dim follows the pull, and is left to its own fades at rest.
      if (overlay && !closing && ready) {
        if (share < 1) overlay.style.opacity = String(share);
        else overlay.style.removeProperty('opacity');
      }
      if (!ready || closing || el.scrollTop > GONE) return;
      // Swiped away. Closing from here has no exit to play: it has left.
      closing = true;
      el.dataset.swiped = '';
      close.current?.click();
      // A dialog that wouldn't close (unsaved, busy) is brought back.
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          if (el.isConnected && !el.hasAttribute('data-closed') && !el.hasAttribute('data-ending-style')) refuse();
        }),
      );
    };

    // A turned screen or a shown keyboard resizes it: keep its place.
    const observer = new ResizeObserver(() => {
      if (!closing) el.scrollTop = share * el.clientHeight;
    });
    observer.observe(el);
    el.addEventListener('scroll', onScroll, { passive: true });
    // Not before it has settled in: the first scroll events are our own.
    const frame = requestAnimationFrame(() => requestAnimationFrame(() => (ready = true)));
    return () => {
      cancelAnimationFrame(frame);
      cancelAnimationFrame(pinning);
      el.removeEventListener('touchstart', touch);
      observer.disconnect();
      el.removeEventListener('scroll', onScroll);
    };
  }, [inside, close]);
}

/** The popup as a scroll view, with `children` in a card on its frame. */
export function Pane({
  slot,
  align,
  cardClassName,
  popupProps,
  children,
  closeSlot,
}: {
  slot: 'dialog-content' | 'sheet-content';
  align: PaneAlign;
  cardClassName: string;
  popupProps: Omit<DialogPrimitive.Popup.Props, 'className' | 'children'>;
  children: ReactNode;
  closeSlot: string;
}) {
  // The popup mounts after this does, so the frame inside it is held as
  // state: the scroll logic starts when it is there, before it first paints.
  const [frame, setFrame] = useState<HTMLDivElement | null>(null);
  const close = useRef<HTMLButtonElement>(null);
  usePaneScroll(frame, close);

  return (
    <DialogPrimitive.Popup
      data-slot={slot.replace('content', 'pane')}
      className='solstice-pane'
      {...popupProps}
    >
      <div className='solstice-pane-dead' aria-hidden />
      <div
        ref={setFrame}
        className='solstice-pane-frame'
        data-align={align}
        // The dim around the card is part of the scroll view, so a press on
        // it is no longer a press outside the popup: it closes here.
        onClick={(event) => event.target === event.currentTarget && close.current?.click()}
      >
        <div data-slot={slot} className={cn('relative', cardClassName)}>
          {children}
        </div>
      </div>
      <DialogPrimitive.Close ref={close} data-slot={closeSlot} className='sr-only' tabIndex={-1} aria-hidden />
    </DialogPrimitive.Popup>
  );
}
