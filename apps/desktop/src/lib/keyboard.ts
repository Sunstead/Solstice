import { useEffect, useLayoutEffect, useState, useSyncExternalStore } from 'react';
import { create } from 'zustand';

import { nativeKeyboard } from '@/lib/backend/native';
import { can } from '@/lib/backend/platform';

/**
 * The on-screen keyboard, as the page sees it.
 *
 * - `inset`: how much of the app's bottom it covers, in CSS pixels; 0 for a
 *   floating keyboard, a hardware keyboard's bar, or none. Also on `<html>`
 *   as `--keyboard-inset`.
 * - `docked`: a keyboard is up along the bottom.
 *
 * Nothing resizes for it: the app keeps its full height, and only the editor
 * being typed in makes room (`useKeyboardRoom`), along with the dialogs,
 * which centre above it. The keyboard bar sits on top of it.
 */
export const useKeyboard = create<{ inset: number; docked: boolean }>(() => ({
  inset: 0,
  docked: false,
}));

/** A keyboard is at least this tall; the iPad's shortcut bar and browser chrome aren't. */
const KEYBOARD_MIN_PX = 150;

function publish(inset: number, docked: boolean) {
  const rounded = Math.max(0, Math.round(inset));
  document.documentElement.style.setProperty('--keyboard-inset', `${rounded}px`);
  const now = useKeyboard.getState();
  if (now.inset !== rounded || now.docked !== docked) useKeyboard.setState({ inset: rounded, docked });
}

/**
 * Follows the keyboard. In the iOS app the native side reports it
 * (`WebviewFit`, which keeps the webview its full height). In a browser it's
 * read from the visual viewport: iOS ignores `interactive-widget`, keeps the
 * layout viewport's height and scrolls the page under the keyboard, top bar
 * and all, so that scroll is undone here too.
 */
export function useKeyboardTracking() {
  useEffect(() => {
    const root = document.documentElement;
    const cleanup = () => {
      root.style.removeProperty('--keyboard-inset');
      useKeyboard.setState({ inset: 0, docked: false });
    };

    if (can.nativeViews) {
      let cancelled = false;
      let stop: (() => void) | undefined;
      void nativeKeyboard
        .listen(({ inset, docked }) => publish(docked ? inset : 0, docked))
        .then((listener) => {
          if (cancelled) void listener.unregister();
          else stop = () => void listener.unregister();
        });
      return () => {
        cancelled = true;
        stop?.();
        cleanup();
      };
    }

    const vv = window.visualViewport;
    if (!vv) return;
    // Android resizes the layout viewport too (the app shrinks with it, so
    // there's nothing to cover): compare with the tallest seen at this width
    // to know a keyboard is up at all.
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
        const covering = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
        const docked = Math.max(covering, tallest - vv.height) > KEYBOARD_MIN_PX;
        // The bar a hardware keyboard (or Scribble) brings up covers a strip
        // of the bottom; nothing makes room for it.
        publish(docked ? covering : 0, docked);
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
      cleanup();
    };
  }, []);
}

/** The keyboard bar's height (`KeyboardBar`). */
export const KEYBOARD_BAR_PX = 44;
/** Its margin when it floats at a pane's foot rather than on a keyboard. */
export const KEYBOARD_BAR_GAP_PX = 8;

/**
 * What has focus, for the keyboard bar and the editor making room: the
 * focused element, and whether it's a note editor (ProseMirror; a tab's or a
 * canvas card's), whose formatting the bar offers.
 */
export const useEditingFocus = create<{ element: HTMLElement | null; note: boolean }>(() => ({
  element: null,
  note: false,
}));

/** Keeps `useEditingFocus` current. Mount once (the root does). */
export function useEditingFocusTracking() {
  useEffect(() => {
    const check = () => {
      const active = document.activeElement as HTMLElement | null;
      const editable =
        active && active !== document.body && (active.isContentEditable || active.matches('input, textarea'))
          ? active
          : null;
      const note = !!editable?.closest('.ProseMirror[data-command-surface]');
      const now = useEditingFocus.getState();
      if (now.element !== editable || now.note !== note) useEditingFocus.setState({ element: editable, note });
    };
    check();
    document.addEventListener('focusin', check);
    document.addEventListener('focusout', check);
    return () => {
      document.removeEventListener('focusin', check);
      document.removeEventListener('focusout', check);
    };
  }, []);
}

const coarse = typeof window !== 'undefined' ? window.matchMedia('(pointer: coarse)') : null;
const subscribeCoarse = (onChange: () => void) => {
  coarse?.addEventListener('change', onChange);
  return () => coarse?.removeEventListener('change', onChange);
};

/** A touch screen: where the keyboard bar shows. */
export function useTouchScreen() {
  return useSyncExternalStore(subscribeCoarse, () => !!coarse?.matches, () => false);
}

/** Whether the keyboard bar is up: a note editor has focus on a touch screen. */
export function useKeyboardBarShown() {
  const touch = useTouchScreen();
  const note = useEditingFocus((s) => s.note);
  return touch && note;
}

/** `el`'s place on screen, kept current as it or the window changes size. */
export function useRect(el: HTMLElement | null): DOMRect | null {
  const [rect, setRect] = useState<DOMRect | null>(null);
  useLayoutEffect(() => {
    if (!el) return;
    const measure = () => setRect(el.getBoundingClientRect());
    // Observing reports the size at once, then every change.
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    window.addEventListener('resize', measure);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [el]);
  return el ? rect : null;
}

/**
 * Makes room at the bottom of an editor's scroll area for the keyboard and
 * the keyboard bar, while something in it has focus. Returns a ref for the
 * scroll area's root and the bottom padding to give it, so the scroll
 * viewport inside really ends above them and the editors' own scrolling
 * keeps the caret in view. Only this pane changes: the sidebar, tab strip and
 * other panes stay where they are, under the keyboard if it covers them.
 */
export function useKeyboardRoom(): [(el: HTMLElement | null) => void, string | undefined] {
  const [el, setEl] = useState<HTMLElement | null>(null);
  const { inset, docked } = useKeyboard();
  const focus = useEditingFocus((s) => s.element);
  const bar = useKeyboardBarShown();
  const editing = !!(el && focus && el.contains(focus));
  const rect = useRect(editing ? el : null);

  if (!editing || !rect) return [setEl, undefined];
  const barRoom = bar ? KEYBOARD_BAR_PX : 0;
  if (docked) {
    // How far the keyboard reaches up into this pane.
    const covered = Math.max(0, rect.bottom - (window.innerHeight - inset));
    return [setEl, `${covered + barRoom}px`];
  }
  if (!bar) return [setEl, undefined];
  // The bar sits at the pane's foot, above the home indicator.
  const below = Math.max(0, window.innerHeight - rect.bottom);
  const room = barRoom + KEYBOARD_BAR_GAP_PX;
  return [setEl, `calc(${room}px + max(0px, env(safe-area-inset-bottom) - ${below}px))`];
}
