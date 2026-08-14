import { useEffect } from 'react';

/**
 * Keeps --dpr on the document root in sync with window.devicePixelRatio,
 * including across monitor drags (which change DPR without a resize event).
 */
export function useDevicePixelRatio() {
  useEffect(() => {
    let cleanup: (() => void) | undefined;

    const updateDPR = () => {
      const dpr = window.devicePixelRatio;
      document.documentElement.style.setProperty('--dpr', String(dpr));

      // matchMedia is only valid for the DPR it was created at, so we
      // tear down the old listener and re-arm a fresh one each time.
      cleanup?.();
      const mql = matchMedia(`(resolution: ${dpr}dppx)`);
      mql.addEventListener('change', updateDPR, { once: true });
      cleanup = () => mql.removeEventListener('change', updateDPR);
    };

    updateDPR();
    return () => cleanup?.();
  }, []);
}
