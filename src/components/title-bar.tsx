import { useEffect, useRef, useState } from 'react';
import {
  getCurrentWindow,
  type Window as TauriWindow,
} from '@tauri-apps/api/window';
import { SidebarTrigger } from '@/components/ui/resizable-sidebar';
import { Button } from '@/components/ui/button';
import SolsticeIcon from '@/assets/icons/app/icon.svg?react';
import { useWorkspace } from '@/hooks/use-workspace';
import { AppMenubar } from './app-menubar';

const isTauri = () => '__TAURI_INTERNALS__' in window;

export default function TitleBar() {
  const [isMac, setIsMac] = useState(false);
  const [isDesktop, setIsDesktop] = useState(false);
  const [isMaximized, setIsMaximized] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const appWindowRef = useRef<TauriWindow | null>(null);

  useEffect(() => {
    if (!isTauri()) return;
    setIsDesktop(true);

    const appWindow = getCurrentWindow();
    appWindowRef.current = appWindow;

    let unlisten: (() => void) | null = null;

    const init = async () => {
      setIsMaximized(await appWindow.isMaximized());
      setIsFullscreen(await appWindow.isFullscreen());
      unlisten = await appWindow.onResized(async () => {
        setIsMaximized(await appWindow.isMaximized());
        setIsFullscreen(await appWindow.isFullscreen());
      });
    };
    init();

    return () => {
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    if (!isTauri()) return;
    import('@tauri-apps/plugin-os').then(({ platform }) => {
      setIsMac(platform() === 'macos');
    });
  }, []);

  const appWindow = appWindowRef.current;

  const path = useWorkspace((s) => s.path);

  return (
    <header className='bg-sidebar w-full h-12 min-h-9 draggable relative flex items-center border-b'>
      <div data-tauri-drag-region className='size-full absolute inset-0' />

      <div className='flex items-center z-0 w-max h-max'>
        <div
          data-tauri-drag-region
          className='flex items-center pl-2 select-none'
        >
          {isDesktop && isMac ? (
            !isFullscreen && <span className='w-16' />
          ) : (
            <SolsticeIcon className='mx-2 size-5 pointer-events-none select-none [-webkit-user-drag:none]' />
          )}
          <AppMenubar />
          {/* <SidebarTrigger className='size-10 no-drag z-50 select-all' /> */}
        </div>
      </div>

      {isDesktop && !isMac && (
        <div className='flex ml-auto select-all text-muted-foreground z-50'>
          {/* Minimize */}
          <Button
            className='flex items-center justify-center rounded-none w-12 h-12 select-all z-50 no-drag'
            variant='ghost'
            disabled={!appWindow}
            onClick={() => appWindow!.minimize()}
          >
            <svg
              xmlns='http://www.w3.org/2000/svg'
              width='18'
              height='18'
              viewBox='0 0 24 24'
              strokeWidth='2'
              stroke='currentColor'
              fill='none'
              strokeLinecap='round'
              strokeLinejoin='round'
            >
              <path stroke='none' d='M0 0h24v24H0z' fill='none' />
              <line x1='5' y1='12' x2='19' y2='12' />
            </svg>
          </Button>
          {/* Maximize / Restore */}
          <Button
            className='flex items-center justify-center rounded-none w-12 h-12 select-all z-50 no-drag'
            variant='ghost'
            disabled={!appWindow}
            onClick={() => appWindow!.toggleMaximize()}
          >
            {isMaximized ? (
              <svg
                xmlns='http://www.w3.org/2000/svg'
                width='18'
                height='18'
                viewBox='0 0 16 16'
              >
                <rect
                  style={{
                    fill: 'none',
                    stroke: 'currentColor',
                    strokeWidth: 1.5,
                    strokeLinejoin: 'round',
                  }}
                  width='8'
                  height='8'
                  x='2.5'
                  y='5.5'
                  ry='1.5'
                />
                <path
                  style={{
                    fill: 'none',
                    stroke: 'currentColor',
                    strokeWidth: 1.5,
                    strokeLinecap: 'round',
                    strokeLinejoin: 'round',
                  }}
                  d='M 5 2.5 h 5.5 A 2.5 2.5 0 0 1 13 5 v 5.5'
                />
              </svg>
            ) : (
              <svg
                xmlns='http://www.w3.org/2000/svg'
                width='18'
                height='18'
                viewBox='0 0 16 16'
              >
                <rect
                  style={{
                    fill: 'none',
                    stroke: 'currentColor',
                    strokeWidth: 1.55298,
                    strokeLinejoin: 'round',
                  }}
                  width='9'
                  height='9'
                  x='3.5'
                  y='3.5'
                  ry='2.2857144'
                />
              </svg>
            )}
          </Button>
          {/* Close */}
          <Button
            className='flex items-center justify-center rounded-none w-12 h-12 select-all z-50 no-drag hover:bg-[#dd0623]!'
            variant='ghost'
            disabled={!appWindow}
            onClick={() => appWindow!.close()}
          >
            <svg
              xmlns='http://www.w3.org/2000/svg'
              width='18'
              height='18'
              viewBox='0 0 24 24'
              strokeWidth='2'
              stroke='currentColor'
              fill='none'
              strokeLinecap='round'
              strokeLinejoin='round'
            >
              <path stroke='none' d='M0 0h24v24H0z' fill='none' />
              <path d='M18 6l-12 12' />
              <path d='M6 6l12 12' />
            </svg>
          </Button>
        </div>
      )}
    </header>
  );
}
