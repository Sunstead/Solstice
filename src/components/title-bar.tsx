import { useEffect, useRef, useState } from 'react';
import {
  getCurrentWindow,
  type Window as TauriWindow,
} from '@tauri-apps/api/window';
import SolsticeIcon from '@/assets/icons/app/icon.svg?react';
import { useIsMac } from '@/hooks/use-platform';
import { useSidebar } from './ui/resizable-sidebar';
import { cn } from '@/lib/utils';
import { AppMenubar } from './app-menu-dropdown';

const isTauri = () => '__TAURI_INTERNALS__' in window;

export default function TitleBar() {
  const [isDesktop, setIsDesktop] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const appWindowRef = useRef<TauriWindow | null>(null);

  useEffect(() => {
    if (!isTauri()) return;
    setIsDesktop(true);

    const appWindow = getCurrentWindow();
    appWindowRef.current = appWindow;

    let unlisten: (() => void) | null = null;

    const init = async () => {
      setIsFullscreen(await appWindow.isFullscreen());
      unlisten = await appWindow.onResized(async () => {
        setIsFullscreen(await appWindow.isFullscreen());
      });
    };
    init();

    return () => {
      unlisten?.();
    };
  }, []);

  const isMac = useIsMac();

  return (
    <header className='bg-sidebar w-full h-10 min-h-9 draggable relative flex items-center border-b border-r'>
      <div data-tauri-drag-region className='size-full absolute inset-0' />

      <div className='flex items-center z-0 w-max h-max'>
        <div data-tauri-drag-region className='flex items-center select-none'>
          <div className='min-w-12 flex items-center justify-center'>
            {isDesktop && isMac ? (
              !isFullscreen && <span className='w-16' />
            ) : (
              <SolsticeIcon className='mx-2 size-5 pointer-events-none select-none [-webkit-user-drag:none]' />
            )}
          </div>
          <AppMenubar />
          {/* <SidebarTrigger className='size-10 no-drag z-50 select-all' /> */}
        </div>
      </div>
    </header>
  );
}

export function TitleBarShell() {
  const { state, isDraggingRail } = useSidebar();

  return (
    <div
      className={cn(
        'transition-[width] duration-200 ease-in-out',
        isDraggingRail && 'duration-0!',
      )}
      style={{
        width:
          state === 'collapsed'
            ? 'var(--sidebar-width-icon)'
            : 'var(--sidebar-width)',
      }}
    >
      <TitleBar />
    </div>
  );
}
