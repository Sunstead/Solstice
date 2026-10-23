import { useLayoutEffect, useRef } from 'react';
import { create } from 'zustand';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { Button } from '@sunstead/ui/components/button';
import { can } from '@/lib/backend/platform';
import { useIsMac } from '@/hooks/use-platform';
import { useNavigationHistory } from '@/lib/stores/navigation-history';
import { runCommand } from '@/lib/commands';
import { AppMenubar } from './app-menu-dropdown';
import { SyncIndicator } from './sync/status';
import { UpdateIndicator } from './updates/update-indicator';
import { WorkspaceSwitcher } from './workspace-switcher';
import { useSetting } from '@/lib/settings/store';

/** Where the controls end, from the window's left edge; the tab strip's spacer reads it. */
const useControlsEnd = create<{ end: number }>(() => ({ end: 0 }));

/**
 * The menu, navigation, sync, workspace and update controls. Rendered once,
 * by the title bar, and never moved: with the sidebar open they sit over its
 * empty title area; collapsed, the title bar narrows to the icon rail and
 * they overhang the top-left tab strip, which makes room with
 * `HeaderControlsSpacer`.
 */
export function HeaderControls({ showWorkspaceSwitcher = true }: { showWorkspaceSwitcher?: boolean }) {
  const isMac = useIsMac();
  const workspaceSwitcherLocation = useSetting('appearance.workspaceSwitcherLocation');
  const ref = useRef<HTMLDivElement>(null);
  const canGoBack = useNavigationHistory((s) => s.past.length > 0);
  const canGoForward = useNavigationHistory((s) => s.future.length > 0);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => useControlsEnd.setState({ end: Math.ceil(el.getBoundingClientRect().right) });
    measure();
    // Size changes (the sync button appearing) and the logo slot changing
    // width (macOS fullscreen) both move the right edge.
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    if (el.parentElement) ro.observe(el.parentElement);
    return () => {
      ro.disconnect();
      useControlsEnd.setState({ end: 0 });
    };
  }, []);

  return (
    <div ref={ref} className='no-drag relative z-30 flex h-10 touch:h-11 items-center'>
      {/* macOS has a native menu bar; a browser tab never does. */}
      {/* macOS has the native menu bar; everywhere else draws its own. */}
      {can.appMenu && !(can.windowChrome && isMac) && <AppMenubar />}
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
        {showWorkspaceSwitcher && workspaceSwitcherLocation === 'titlebar' && (
          <WorkspaceSwitcher variant='titlebar' />
        )}
        <UpdateIndicator />
      </div>
    </div>
  );
}

/**
 * Leads the top-left tabset, so its tabs start after the header controls.
 * Sized from where it actually is, every frame the editor moves (the editor
 * area resizes with the sidebar), rather than animated alongside it: two
 * animations never quite agree, and the tabs overshot and bounced back.
 */
export function HeaderControlsSpacer() {
  const ref = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    const layout = el?.closest<HTMLElement>('.flexlayout__layout');
    if (!el || !layout) return;
    const fit = () => {
      // How far the controls reach past the strip's start, negative while
      // they don't. The stylesheets size everything from it (on the layout,
      // so the pane under the tabs can read it too): the spacer's width,
      // plus the room Islands gives the first tab, which its flare and the
      // pane's corner grow into, so the tabs move as one with the sidebar.
      const overhang = useControlsEnd.getState().end - el.getBoundingClientRect().left;
      layout.style.setProperty('--overhang', `${overhang}px`);
    };
    fit();
    // Fires in the same frame as the resize, before paint.
    const ro = new ResizeObserver(fit);
    ro.observe(layout);
    const unsubscribe = useControlsEnd.subscribe(fit);
    return () => {
      ro.disconnect();
      unsubscribe();
      layout.style.removeProperty('--overhang');
    };
  }, []);

  return <span ref={ref} aria-hidden className='header-controls-spacer' />;
}
