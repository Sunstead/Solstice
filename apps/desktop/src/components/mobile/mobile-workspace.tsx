import { useEffect, useReducer, useState } from 'react';
import { ArrowLeft, Ellipsis, Menu } from 'lucide-react';

import { Button } from '@sunstead/ui/components/button';
import { useSidebar } from '@sunstead/ui/components/resizable-sidebar';
import { TabContent } from '@/components/tab-content';
import { SyncIndicator } from '@/components/sync/status';
import { WindowControls } from '@/components/window-controls';
import { useLayout } from '@/hooks/use-layout';
import { useLayoutSession } from '@/hooks/use-layout-session';
import { useIsFullscreen } from '@/hooks/use-fullscreen';
import { useIsMac } from '@/hooks/use-platform';
import { isDesktop } from '@/lib/backend';
import { runCommand } from '@/lib/commands';
import { useSetting } from '@/lib/settings/store';
import { useEntryInput } from '@/lib/stores/entry-input';
import { useNavigationHistory } from '@/lib/stores/navigation-history';
import { MobileMenu } from './mobile-menu';
import { TabSwitcher } from './tab-switcher';
import { allTabs, shownTab, tabTitle } from './tabs';

/**
 * The editor area on a phone (and in a desktop window that narrow): one tab
 * at a time under a top bar, with the tabs in a switcher and the sidebar in a
 * drawer. It reads and drives the same flexlayout model as the tabs do, so
 * splits survive a trip through it and come back on a wider window.
 */
export function MobileWorkspace() {
  const model = useLayout((s) => s.model);
  const [, redraw] = useReducer((n: number) => n + 1, 0);
  const handleModelChange = useLayoutSession();
  const { setOpenMobile } = useSidebar();

  useEffect(() => {
    if (!model) return;
    const listener = () => {
      handleModelChange(model);
      redraw();
    };
    model.addChangeListener(listener);
    return () => model.removeChangeListener(listener);
  }, [model, handleModelChange]);

  const shown = model ? shownTab(model) : null;
  const shownId = shown?.getId();

  // Opening something (from the drawer, quick open, a link) closes the drawer.
  useEffect(() => {
    setOpenMobile(false);
  }, [shownId, setOpenMobile]);

  // New note, folder or canvas is named in the file tree: show it.
  const creating = useEntryInput((s) => s.operation !== null);
  useEffect(() => {
    if (creating) setOpenMobile(true);
  }, [creating, setOpenMobile]);

  if (!model) return null;

  return (
    <div className='flex h-full w-full flex-col'>
      <MobileTopBar />
      <div className='relative min-h-0 flex-1 bg-background'>{shown && <TabContent key={shownId} node={shown} />}</div>
    </div>
  );
}

function MobileTopBar() {
  const model = useLayout((s) => s.model)!;
  const showExtensions = useSetting('explorer.showFileExtensions');
  const canGoBack = useNavigationHistory((s) => s.past.length > 0);
  const { setOpenMobile } = useSidebar();
  const isMac = useIsMac();
  const isFullscreen = useIsFullscreen();
  const [tabsOpen, setTabsOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const shown = shownTab(model);
  const count = allTabs(model).length;

  return (
    <header
      data-tauri-drag-region
      className='flex h-12 shrink-0 items-center gap-1 border-b bg-sidebar px-1.5'
    >
      {/* The traffic lights sit over the top-left corner on macOS. */}
      {isDesktop && isMac && !isFullscreen && <span data-tauri-drag-region className='w-16 shrink-0' />}
      <Button variant='ghost' size='icon' className='no-drag' onClick={() => setOpenMobile(true)}>
        <Menu />
        <span className='sr-only'>Open sidebar</span>
      </Button>
      {canGoBack && (
        <Button variant='ghost' size='icon' className='no-drag' onClick={() => void runCommand('navigation.back')}>
          <ArrowLeft />
          <span className='sr-only'>Back</span>
        </Button>
      )}
      <h1 data-tauri-drag-region className='min-w-0 flex-1 truncate px-1 text-sm font-medium'>
        {shown ? tabTitle(shown, showExtensions) : ''}
      </h1>
      <div className='no-drag flex items-center gap-0.5'>
        <SyncIndicator />
        <Button variant='ghost' size='icon' onClick={() => setTabsOpen(true)}>
          <span className='flex size-5 items-center justify-center rounded-[5px] border-[1.5px] border-current text-[11px] leading-none font-semibold'>
            {count > 99 ? '99+' : count}
          </span>
          <span className='sr-only'>Tabs</span>
        </Button>
        <Button variant='ghost' size='icon' onClick={() => setMenuOpen(true)}>
          <Ellipsis />
          <span className='sr-only'>Menu</span>
        </Button>
        {isDesktop && !isMac && <WindowControls />}
      </div>
      <TabSwitcher model={model} shown={shown} open={tabsOpen} onOpenChange={setTabsOpen} />
      <MobileMenu open={menuOpen} onOpenChange={setMenuOpen} />
    </header>
  );
}
