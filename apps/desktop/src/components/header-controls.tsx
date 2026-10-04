import { useLayoutEffect, useRef } from 'react';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { Button } from '@sunstead/ui/components/button';
import { useSidebar } from '@sunstead/ui/components/resizable-sidebar';
import { isDesktop } from '@/lib/backend';
import { useIsMac } from '@/hooks/use-platform';
import { useNavigationHistory } from '@/lib/stores/navigation-history';
import { runCommand } from '@/lib/commands';
import { cn } from '@/lib/utils';
import { AppMenubar } from './app-menu-dropdown';
import { SyncIndicator } from './sync/status';

/** Where the controls end, from the window's left edge; the tab strip's spacer reads it. */
const END_VAR = '--header-controls-end';

/**
 * The menu, Back, Forward and sync buttons. Rendered once, by the title bar,
 * and never moved: with the sidebar open they sit over its empty title area;
 * collapsed, the title bar narrows to the icon rail and they overhang the
 * top-left tab strip, which makes room with `HeaderControlsSpacer`.
 */
export function HeaderControls() {
  const isMac = useIsMac();
  const ref = useRef<HTMLDivElement>(null);
  const canGoBack = useNavigationHistory((s) => s.past.length > 0);
  const canGoForward = useNavigationHistory((s) => s.future.length > 0);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const root = document.documentElement;
    const measure = () => root.style.setProperty(END_VAR, `${Math.ceil(el.getBoundingClientRect().right)}px`);
    measure();
    // Size changes (the sync button appearing) and the logo slot changing
    // width (macOS fullscreen) both move the right edge.
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    if (el.parentElement) ro.observe(el.parentElement);
    return () => {
      ro.disconnect();
      root.style.removeProperty(END_VAR);
    };
  }, []);

  return (
    <div ref={ref} className='no-drag relative z-30 flex h-10 items-center'>
      {/* macOS has a native menu bar; a browser tab never does. */}
      {(!isDesktop || !isMac) && <AppMenubar />}
      <div className='ml-1 flex items-center gap-x-1'>
        <Button variant='ghost' size='icon-sm' disabled={!canGoBack} onClick={() => runCommand('navigation.back')}>
          <ArrowLeft />
          <span className='sr-only'>Back</span>
        </Button>
        <Button
          variant='ghost'
          size='icon-sm'
          disabled={!canGoForward}
          onClick={() => runCommand('navigation.forward')}
        >
          <ArrowRight />
          <span className='sr-only'>Forward</span>
        </Button>
        <SyncIndicator />
      </div>
    </div>
  );
}

/**
 * Leads the top-left tabset, so its tabs start after the header controls.
 * Its width tracks the sidebar column with the same easing, so tabs never
 * pass under the controls while the sidebar opens or closes.
 */
export function HeaderControlsSpacer() {
  const { state, isDraggingRail } = useSidebar();
  return (
    <span
      aria-hidden
      data-collapsed={state === 'collapsed'}
      className={cn('header-controls-spacer', isDraggingRail && 'duration-0!')}
    />
  );
}
