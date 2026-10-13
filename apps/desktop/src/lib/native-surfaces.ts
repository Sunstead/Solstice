import { useCallback } from 'react';
import { nativeSurfaces } from '@/lib/backend/native';

/**
 * What the iOS app's native views (`NativeSurface`) share: keeping each on
 * its element's frame, making what's under it see-through, and telling the
 * native side when web content is over them.
 */

/** How many surfaces each see-through element is under, and its own colour. */
const marks = new Map<Element, { count: number; background: string }>();
export const refreshers = new Set<() => void>();

function mark(el: Element) {
  const known = marks.get(el);
  if (known) return void (known.count += 1);
  marks.set(el, { count: 1, background: getComputedStyle(el).backgroundColor });
  el.setAttribute('data-native-under', '');
}

export function unmark(el: Element) {
  const known = marks.get(el);
  if (known && known.count > 1) return void (known.count -= 1);
  marks.delete(el);
  el.removeAttribute('data-native-under');
}

/**
 * Makes everything painted under the surface see-through (app.css): not only
 * its ancestors, but the siblings stacked beneath it, like flexlayout's
 * tabset, which draws its background apart from the tab's content.
 */
export function seeThrough(el: HTMLElement, r: DOMRect, under: Set<Element>) {
  const found = new Set<Element>();
  // The colour the surface used to sit on, painted natively in its place.
  let background: number[] | null = null;
  const inset = 2;
  const points = [
    [r.left + r.width / 2, r.top + r.height / 2],
    [r.left + inset, r.top + inset],
    [r.right - inset, r.top + inset],
    [r.left + inset, r.bottom - inset],
    [r.right - inset, r.bottom - inset],
  ];
  for (const [x, y] of points) {
    const stack = document.elementsFromPoint(x, y);
    const at = stack.indexOf(el);
    if (at === -1) continue;
    for (const below of stack.slice(at + 1)) {
      found.add(below);
      if (!background) {
        background = toRgb(marks.get(below)?.background ?? getComputedStyle(below).backgroundColor);
      }
    }
  }
  for (const below of under) if (!found.has(below)) unmark(below);
  for (const below of found) if (!under.has(below)) mark(below);
  under.clear();
  for (const below of found) under.add(below);
  if (background) void nativeSurfaces.background(background);
}

/** Frames with nothing moving before a follow stops polling. */
const SETTLE_FRAMES = 10;

/**
 * Calls `measure` every frame while anything could be moving it (a resize, a
 * scroll, an animation, an overlay opening), and stops once it has been still
 * for a few frames, so an idle page costs nothing.
 */
export function follow(el: HTMLElement, measure: () => boolean): () => void {
  let frame = 0;
  let still = 0;
  const tick = () => {
    const moved = measure();
    checkOverlays();
    still = moved || document.getAnimations().length > 0 ? 0 : still + 1;
    frame = still < SETTLE_FRAMES ? requestAnimationFrame(tick) : 0;
  };
  const kick = () => {
    still = 0;
    if (!frame) frame = requestAnimationFrame(tick);
  };

  kicks.add(kick);
  const resize = new ResizeObserver(kick);
  resize.observe(el);
  resize.observe(document.documentElement);
  // Overlays come and go as children of <body>; anything that moves the
  // surface also resizes something the observer above sees.
  const mutations = new MutationObserver(kick);
  mutations.observe(document.body, { childList: true });
  window.addEventListener('resize', kick);
  window.addEventListener('scroll', kick, true);
  window.visualViewport?.addEventListener('resize', kick);
  kick();

  return () => {
    kicks.delete(kick);
    cancelAnimationFrame(frame);
    resize.disconnect();
    mutations.disconnect();
    window.removeEventListener('resize', kick);
    window.removeEventListener('scroll', kick, true);
    window.visualViewport?.removeEventListener('resize', kick);
  };
}

// -- What every surface shares ------------------------------------------

let holders = 0;
let stopHost: (() => void) | null = null;
let modal = false;
let sentRects = '';
const kicks = new Set<() => void>();
const overSurface = new Set<Element>();

/**
 * For web content in the page that floats over a surface (the find bar):
 * touches on it stay the webview's.
 */
export function useOverSurface() {
  return useCallback((el: HTMLElement | null) => {
    if (!el) return;
    overSurface.add(el);
    kicks.forEach((kick) => kick());
    return () => {
      overSurface.delete(el);
      kicks.forEach((kick) => kick());
    };
  }, []);
}

/**
 * Whether a menu, popover or dialog is open: they mount in their own nodes
 * under `<body>`, beside `#root`. While one is, the webview takes every touch,
 * so a tap outside it closes it, as it would on the web.
 */
function checkOverlays() {
  const open = [...document.body.children].some(
    (el) =>
      el.id !== 'root' &&
      !(el instanceof HTMLScriptElement || el instanceof HTMLStyleElement) &&
      el.getBoundingClientRect().width > 0,
  );
  const rects = [...overSurface]
    .map((el) => el.getBoundingClientRect())
    .filter((r) => r.width > 0 && r.height > 0)
    .map(({ x, y, width, height }) => ({ x, y, width, height }));
  const key = JSON.stringify(rects);
  if (open === modal && key === sentRects) return;
  modal = open;
  sentRects = key;
  void nativeSurfaces.overlays(open, rects);
}

/** Marks the page as hosting surfaces, and follows theme changes. */
export function retainHost(): () => void {
  holders += 1;
  if (holders === 1) stopHost = startHost();
  return () => {
    holders -= 1;
    if (holders === 0) {
      stopHost?.();
      stopHost = null;
    }
  };
}

function startHost(): () => void {
  const root = document.documentElement;
  root.dataset.nativeHost = '';
  const theme = new MutationObserver(() => refreshers.forEach((refresh) => refresh()));
  theme.observe(root, { attributes: true, attributeFilter: ['data-theme', 'class', 'style'] });

  return () => {
    theme.disconnect();
    delete root.dataset.nativeHost;
    if (modal || sentRects !== '[]') {
      modal = false;
      sentRects = '[]';
      void nativeSurfaces.overlays(false, []);
    }
  };
}

/** Any CSS colour (themes use oklch) as sRGB, by painting it; none if see-through. */
function toRgb(color: string): number[] | null {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1;
  const context = canvas.getContext('2d');
  if (!context) return null;
  context.fillStyle = color;
  context.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = context.getImageData(0, 0, 1, 1).data;
  return a === 0 ? null : [r, g, b];
}
