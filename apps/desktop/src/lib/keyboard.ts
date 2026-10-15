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
 * - `hardware`: a hardware keyboard is attached (the iOS app; a browser
 *   can't tell). It types, so the keyboard bar stays away.
 *
 * Nothing resizes for it: the app keeps its full height, and only the editor
 * being typed in makes room (`useKeyboardRoom`), along with the dialogs,
 * which centre above it. The keyboard bar sits on top of it.
 */
export const useKeyboard = create<{ inset: number; docked: boolean; hardware: boolean }>(() => ({
  inset: 0,
  docked: false,
  hardware: false,
}));

/** A keyboard is at least this tall; the iPad's shortcut bar and browser chrome aren't. */
const KEYBOARD_MIN_PX = 150;

function publish(inset: number, docked: boolean, hardware = useKeyboard.getState().hardware) {
  const rounded = Math.max(0, Math.round(inset));
  document.documentElement.style.setProperty('--keyboard-inset', `${rounded}px`);
  const now = useKeyboard.getState();
  if (now.inset !== rounded || now.docked !== docked || now.hardware !== hardware) {
    useKeyboard.setState({ inset: rounded, docked, hardware });
  }
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
      useKeyboard.setState({ inset: 0, docked: false, hardware: false });
    };

    if (can.nativeViews) {
      let cancelled = false;
      let stop: (() => void) | undefined;
      void nativeKeyboard
        .listen(({ inset, docked, hardware }) => publish(docked ? inset : 0, docked, !!hardware))
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

/** `el` if it's text to type in: a field, or an editor. */
export function editableElement(el: Element | null): HTMLElement | null {
  if (!(el instanceof HTMLElement) || el === document.body) return null;
  return el.isContentEditable || el.matches('input, textarea') ? el : null;
}

/** Keeps `useEditingFocus` current. Mount once (the root does). */
export function useEditingFocusTracking() {
  useEffect(() => {
    const check = () => {
      const editable = editableElement(document.activeElement);
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

// Not in every environment this loads in (tests).
const coarse = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(pointer: coarse)') : null;
const subscribeCoarse = (onChange: () => void) => {
  coarse?.addEventListener('change', onChange);
  return () => coarse?.removeEventListener('change', onChange);
};

/** A touch screen: where the keyboard bar shows. */
export function useTouchScreen() {
  return useSyncExternalStore(subscribeCoarse, () => !!coarse?.matches, () => false);
}

/**
 * Whether the keyboard bar is up: a note editor has focus on a touch screen,
 * and no hardware keyboard is there to format with.
 */
export function keyboardBarShown({ touch, note, hardware }: { touch: boolean; note: boolean; hardware: boolean }) {
  return touch && note && !hardware;
}

export function useKeyboardBarShown() {
  const touch = useTouchScreen();
  const note = useEditingFocus((s) => s.note);
  const hardware = useKeyboard((s) => s.hardware);
  return keyboardBarShown({ touch, note, hardware });
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
  return [setEl, keyboardRoom({ rect, viewportHeight: window.innerHeight, inset, docked, bar })];
}

/**
 * The bottom padding a pane ending at `rect.bottom` needs to keep what's
 * typed above the keyboard and the keyboard bar; none when nothing covers it.
 */
export function keyboardRoom({
  rect,
  viewportHeight,
  inset,
  docked,
  bar,
}: {
  rect: { bottom: number };
  viewportHeight: number;
  inset: number;
  docked: boolean;
  bar: boolean;
}): string | undefined {
  const barRoom = bar ? KEYBOARD_BAR_PX : 0;
  if (docked) {
    // How far the keyboard reaches up into this pane.
    const covered = Math.max(0, rect.bottom - (viewportHeight - inset));
    return `${covered + barRoom}px`;
  }
  if (!bar) return undefined;
  // The bar sits at the pane's foot, above the home indicator.
  const below = Math.max(0, viewportHeight - rect.bottom);
  const room = barRoom + KEYBOARD_BAR_GAP_PX;
  return `calc(${room}px + max(0px, env(safe-area-inset-bottom) - ${below}px))`;
}

/** Room kept between the caret and the keyboard: about a line. */
const CARET_ROOM_PX = 32;

/**
 * How far content ending at `caretBottom` (viewport pixels), and a line's
 * room under it, reaches behind a docked keyboard and the keyboard bar on
 * it: how far to move it up.
 */
export function caretOverlap({
  caretBottom,
  viewportHeight,
  inset,
  bar,
}: {
  caretBottom: number;
  viewportHeight: number;
  inset: number;
  bar: boolean;
}): number {
  const floor = viewportHeight - inset - (bar ? KEYBOARD_BAR_PX : 0);
  return Math.max(0, caretBottom + CARET_ROOM_PX - floor);
}

/** Room between a floating panel and what it's for. */
const PANEL_GAP_PX = 6;
/** Room kept between a floating panel and the screen's edges (or the keyboard). */
const PANEL_MARGIN_PX = 8;

/**
 * Where a floating panel of `size` goes for `anchor` (in viewport pixels):
 * on its `prefer` side, or the other when the keyboard (`inset` from the
 * bottom) or the screen's edge would cut it off there, and always on screen
 * above the keyboard.
 */
export function placeAboveKeyboard(
  anchor: { top: number; bottom: number; left: number },
  size: { width: number; height: number },
  viewport: { width: number; height: number },
  inset: number,
  prefer: 'below' | 'above' = 'below',
): { top: number; left: number } {
  const floor = viewport.height - inset - PANEL_MARGIN_PX;
  const below = anchor.bottom + PANEL_GAP_PX;
  const above = anchor.top - PANEL_GAP_PX - size.height;
  const fitsBelow = below + size.height <= floor;
  const fitsAbove = above >= PANEL_MARGIN_PX;
  let top: number;
  if (prefer === 'above') top = fitsAbove ? above : fitsBelow ? below : floor - size.height;
  else top = fitsBelow ? below : fitsAbove ? above : floor - size.height;
  top = Math.max(PANEL_MARGIN_PX, Math.min(top, floor - size.height));
  const left = Math.max(PANEL_MARGIN_PX, Math.min(anchor.left, viewport.width - size.width - PANEL_MARGIN_PX));
  return { top, left };
}

/**
 * Keeps a fixed floating panel by `anchor` and above the keyboard
 * (`placeAboveKeyboard`): a ref for the panel, and where it goes.
 */
export function useAboveKeyboard(
  anchor: { top: number; bottom: number; left: number },
  prefer: 'below' | 'above' = 'below',
): [(el: HTMLElement | null) => void, { top: number; left: number }] {
  const [el, setEl] = useState<HTMLElement | null>(null);
  const inset = useKeyboard((s) => s.inset);
  const rect = useRect(el);
  const size = rect ? { width: rect.width, height: rect.height } : { width: 0, height: 0 };
  const viewport = { width: window.innerWidth, height: window.innerHeight };
  return [setEl, placeAboveKeyboard(anchor, size, viewport, inset, prefer)];
}

/**
 * Whether a tap should focus the text afresh to bring the keyboard back: a
 * finger tapped inside the text that has focus, and no keyboard (on-screen
 * or hardware) is there to type with. That's the note after Scribble: iOS
 * keeps it focused with no keyboard, and a tap on a focused field starts
 * nothing new.
 */
export function shouldRefocus({
  touch,
  focused,
  target,
  docked,
  hardware,
}: {
  touch: boolean;
  focused: HTMLElement | null;
  target: EventTarget | null;
  docked: boolean;
  hardware: boolean;
}): boolean {
  return touch && !docked && !hardware && !!focused && target instanceof Node && focused.contains(target);
}

/**
 * Brings the keyboard back for a finger tap in focused text with none up
 * (`shouldRefocus`): focuses it again inside the tap, which iOS raises the
 * keyboard for, keeping the caret where the tap put it. Mount once (the
 * root does).
 */
export function useKeyboardRefocus() {
  useEffect(() => {
    let touch = false;
    const down = (e: PointerEvent) => {
      touch = e.pointerType === 'touch';
    };
    const click = (e: MouseEvent) => {
      const focused = useEditingFocus.getState().element;
      const { docked, hardware } = useKeyboard.getState();
      if (!coarse?.matches || !shouldRefocus({ touch, focused, target: e.target, docked, hardware })) return;
      refocus(focused!);
    };
    document.addEventListener('pointerdown', down, true);
    document.addEventListener('click', click, true);
    return () => {
      document.removeEventListener('pointerdown', down, true);
      document.removeEventListener('click', click, true);
    };
  }, []);
}

function refocus(el: HTMLElement) {
  // The editors (ProseMirror, CodeMirror) read their selection from the
  // page's, so putting it back keeps the caret where it was.
  const selection = document.getSelection();
  const range = selection && selection.rangeCount > 0 ? selection.getRangeAt(0).cloneRange() : null;
  const field = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement ? el : null;
  const [start, end] = field ? [field.selectionStart, field.selectionEnd] : [null, null];
  el.blur();
  el.focus({ preventScroll: true });
  if (field && start !== null && end !== null) field.setSelectionRange(start, end);
  else if (range && selection) {
    selection.removeAllRanges();
    selection.addRange(range);
  }
}
