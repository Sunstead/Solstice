import { useEffect, useState } from 'react';
import { can } from '@/lib/backend/platform';
import { getCurrentWindow } from '@/lib/backend/window';

/** Whether the desktop window is fullscreen (macOS hides the traffic lights then). */
export function useIsFullscreen() {
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    if (!can.windowChrome) return;
    const appWindow = getCurrentWindow();
    let unlisten: (() => void) | null = null;
    let live = true;
    void (async () => {
      const now = await appWindow.isFullscreen();
      if (live) setFullscreen(now);
      unlisten = await appWindow.onResized(async () => {
        const next = await appWindow.isFullscreen();
        if (live) setFullscreen(next);
      });
    })();
    return () => {
      live = false;
      unlisten?.();
    };
  }, []);

  return fullscreen;
}
