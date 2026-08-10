import { useEffect, useState } from 'react';
import {
  getCurrentWindow,
  type Window as TauriWindow,
} from '@tauri-apps/api/window';
import { Button } from '@/components/ui/button';

const appWindow: TauriWindow = getCurrentWindow(); // sync, safe at module scope

export function WindowControls() {
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let cancelled = false;

    const init = async () => {
      const maximized = await appWindow.isMaximized();
      if (!cancelled) setIsMaximized(maximized);
      unlisten = await appWindow.onResized(async () => {
        const m = await appWindow.isMaximized();
        if (!cancelled) setIsMaximized(m);
      });
    };
    init();

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  return (
    <div className='flex ml-auto select-all text-muted-foreground z-50 order-1 h-full window-controls'>
      {/* Minimize */}
      <Button
        className='flex items-center justify-center rounded-none w-11 h-full select-all z-50 no-drag'
        variant='ghost'
        disabled={!appWindow}
        onClick={() => appWindow!.minimize()}
        onMouseDown={(e) => e.preventDefault()}
        onPointerDown={(e) => e.preventDefault()}
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
        className='flex items-center justify-center rounded-none w-11 h-full select-all z-50 no-drag'
        variant='ghost'
        disabled={!appWindow}
        onClick={() => appWindow!.toggleMaximize()}
        onMouseDown={(e) => e.preventDefault()}
        onPointerDown={(e) => e.preventDefault()}
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
        className='flex items-center justify-center rounded-none w-11 h-full select-all z-50 no-drag hover:bg-[#dd0623]!'
        variant='ghost'
        disabled={!appWindow}
        onClick={() => appWindow!.close()}
        onMouseDown={(e) => e.preventDefault()}
        onPointerDown={(e) => e.preventDefault()}
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
  );
}