import { useCallback, useLayoutEffect, useRef } from 'react';

import { createBadgeGesture, type BadgeGesture } from '@/lib/ink/badge-gesture';
import { badgeLook, selectedSlot, TOOL_LABELS } from '@/lib/ink/toolbox';
import { useOverSurface } from '@/lib/native-surfaces';
import { setSetting } from '@/lib/settings/store';
import { inkDispatch, phoneInk, useInkTools } from '@/lib/stores/ink-tools';
import { ToolIcon } from './tool-icon';

/**
 * The tool in hand while the ribbon is hidden, as Apple's minimized tool
 * picker shows it: a circle of the menus' glass, tinted and rimmed with the
 * ink, in a corner of the content. It drags with a finger or the Pencil and springs to the corner
 * it's thrown toward (`badge-gesture.ts`), kept with the tools; a tap brings
 * the ribbon back.
 */
export function ToolBadge() {
  // An iPhone's header switch is the tools and the finger's drawing together: hidden is off.
  return phoneInk ? null : <Badge />;
}

function Badge() {
  const slot = useInkTools(selectedSlot);
  const corner = useInkTools((s) => s.badgeCorner);
  const overSurface = useOverSurface();
  const area = useRef<HTMLDivElement>(null);
  const badge = useRef<HTMLButtonElement | null>(null);
  const gesture = useRef<BadgeGesture | null>(null);
  const look = badgeLook(slot);
  const label = `Show Tools (${TOOL_LABELS[slot.kind]})`;

  const ref = useCallback(
    (el: HTMLButtonElement | null) => {
      badge.current = el;
      return overSurface(el);
    },
    [overSurface],
  );

  useLayoutEffect(() => {
    const el = badge.current;
    const box = area.current;
    if (!el || !box) return;
    const g = createBadgeGesture(el, () => ({ width: box.clientWidth, height: box.clientHeight, size: el.offsetWidth }), {
      onTap: () => setSetting('ink.ribbon', true),
      onThrow: (to) => inkDispatch({ type: 'setBadgeCorner', corner: to }),
    });
    gesture.current = g;
    const resize = new ResizeObserver(() => g.place(useInkTools.getState().badgeCorner));
    resize.observe(box);
    return () => {
      resize.disconnect();
      g.destroy();
      gesture.current = null;
    };
  }, []);

  useLayoutEffect(() => gesture.current?.place(corner), [corner]);

  return (
    // Where its top-left can go, in from the content's edges.
    <div
      ref={area}
      className='pointer-events-none absolute inset-x-4 top-4 bottom-[calc(1rem+env(safe-area-inset-bottom))] z-20'
    >
      <button
        ref={ref}
        type='button'
        title={label}
        aria-label={label}
        // The menus' glass, the blur on a layer of its own.
        className='pointer-events-auto absolute top-0 left-0 flex size-15 touch-none items-center justify-center rounded-full text-popover-foreground shadow-lg ring-1 ring-foreground/10 transition-shadow select-none before:pointer-events-none before:absolute before:inset-0 before:-z-1 before:rounded-[inherit] before:backdrop-blur-2xl before:backdrop-saturate-150 data-lifted:shadow-2xl'
      >
        {/* The tint and rim, over the blur: under it, a new color showed only once WebKit next redrew the backdrop. */}
        <span
          aria-hidden
          className='pointer-events-none absolute inset-0 rounded-full border-[3px] border-foreground/10'
          style={{ backgroundColor: look.fill, ...(look.rim && { borderColor: look.rim }) }}
        />
        <ToolIcon kind={slot.kind} className='relative size-7' />
      </button>
    </div>
  );
}
