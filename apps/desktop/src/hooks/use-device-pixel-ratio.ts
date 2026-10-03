import { useEffect } from 'react';
import { useIsMac } from './use-platform';

/**
 * Keeps --dpr on the document root in sync with window.devicePixelRatio,
 * including across monitor drags (which change DPR without a resize event).
 */
export function useDevicePixelRatio() {
  const isMac = useIsMac();

  useEffect(() => {
    let mql: MediaQueryList | null = null;

    const updateDPR = () => {
      const dpr = isMac ? 1 : window.devicePixelRatio;
      document.documentElement.style.setProperty('--dpr', String(dpr));

      if (mql) {
        mql.removeEventListener('change', updateDPR);
      }

      mql = window.matchMedia(`(resolution: ${dpr}dppx)`);
      mql.addEventListener('change', updateDPR, { once: true });
    };

    updateDPR();

    return () => {
      if (mql) {
        mql.removeEventListener('change', updateDPR);
      }
    };
  }, [isMac]);
}
