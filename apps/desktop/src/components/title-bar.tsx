import { useEffect, useState } from 'react';
import { getCurrentWindow } from '@/lib/backend/window';
import SolsticeIcon from '@/assets/icons/app/icon.svg?react';
import { isDesktop } from '@/lib/backend';
import { useIsMac } from '@/hooks/use-platform';
import { useSidebar } from '@sunstead/ui/components/resizable-sidebar';
import { cn } from '@/lib/utils';
import { HeaderControls } from './header-controls';

export default function TitleBar() {
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    if (!isDesktop) return;

    const appWindow = getCurrentWindow();
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
    <header className='bg-sidebar w-full h-10 min-h-9 draggable relative flex items-center border-b'>
      <div data-tauri-drag-region className='size-full absolute inset-0' />

      <div className='flex items-center w-max h-max'>
        <div data-tauri-drag-region className='flex items-center select-none'>
          <div className='min-w-12 flex items-center justify-center'>
            {isDesktop && isMac ? (
              !isFullscreen && <span className='w-20' />
            ) : (
              <SolsticeIcon className='mx-2 size-5 pointer-events-none select-none [-webkit-user-drag:none]' />
            )}
          </div>
          <HeaderControls />
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
