import { useEffect } from 'react';
import { create } from 'zustand';

/** Whether an on-screen keyboard is up. */
export const useViewport = create<{ keyboard: boolean }>(() => ({ keyboard: false }));

/** A keyboard is at least this tall; the iPad's shortcut bar and browser chrome aren't. */
const KEYBOARD_MIN_PX = 150;

/**
 * Sizes the app to what's visible above the on-screen keyboard. iOS ignores
 * `interactive-widget`: the layout viewport keeps its height when the keyboard
 * opens, and the page scrolls under it, top bar and all. This sets
 * `--app-height` to the visual viewport and undoes that scroll, so the editor
 * scrolls inside its own pane and ends at the keyboard.
 */
export function useVisualViewport() {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const root = document.documentElement;
    // Android resizes the layout viewport too, so compare with the tallest
    // seen at this width as well.
    let tallest = 0;
    let width = 0;
    let frame = 0;

    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        // Pinch zoom shrinks the visual viewport too; that's not a keyboard.
        if (Math.abs(vv.scale - 1) > 0.01) return;
        if (vv.width !== width) {
          width = vv.width;
          tallest = 0;
        }
        tallest = Math.max(tallest, vv.height);
        const covered = Math.max(window.innerHeight - vv.height - vv.offsetTop, tallest - vv.height);
        root.style.setProperty('--app-height', `${vv.height}px`);
        const keyboard = covered > KEYBOARD_MIN_PX;
        if (useViewport.getState().keyboard !== keyboard) useViewport.setState({ keyboard });
        if (window.scrollY !== 0) window.scrollTo(0, 0);
      });
    };

    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      cancelAnimationFrame(frame);
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
      root.style.removeProperty('--app-height');
    };
  }, []);
}
