import { create } from 'zustand';
import { commands } from '@/lib/backend';
import { nativeSurfaces, type SurfaceEvent } from '@/lib/backend/native';
import { followInkTools } from '@/lib/ink/native-sync';
import { useEditingFocus } from '@/lib/keyboard';
import { getSetting, subscribeToSetting } from '@/lib/settings/store';
import { kicks, kickSurfaces, overSurface } from '@/lib/surface-kicks';

export { useOverSurface } from '@/lib/surface-kicks';

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
 * tabset, which draws its background apart from the tab's content. Only on
 * the surface's own page, though: a phone's note is pushed over the file
 * list, which must stay as it is (the pushed page hides it, `PushPane`).
 */
export function seeThrough(el: HTMLElement, r: DOMRect, under: Set<Element>): number[] | null {
  const found = new Set<Element>();
  const page = el.closest('.solstice-push-page, [data-surface-root]');
  const onPage = (below: Element) => !page || page.contains(below) || below.contains(page);
  // The colour the surface used to sit on: the surface's own backdrop (a
  // PDF's margins), and the host's too, except that under Islands the host
  // shows in the gaps and a pane's rounded corners, which go see-through
  // with everything else, so it's the window's there.
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
      if (!onPage(below)) continue;
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
  const islands = document.documentElement.dataset.islands === 'true';
  const host = (islands && windowColour()) || background;
  if (host) void nativeSurfaces.background(host);
  return background;
}

/** Frames with nothing moving before a follow stops polling. */
const SETTLE_FRAMES = 10;

/**
 * Whether an animation finishes. One that never does (a spinner) moves
 * nothing, and would keep `follow` measuring every frame while it spun.
 */
function ends(animation: Animation): boolean {
  return animation.effect?.getTiming().iterations !== Infinity;
}

/**
 * Calls `measure` every frame while anything could be moving it (a resize, a
 * scroll, an animation that ends, an overlay opening), and stops once it has been still
 * for a few frames, so an idle page costs nothing.
 */
export function follow(el: HTMLElement, measure: () => boolean): () => void {
  let frame = 0;
  let still = 0;
  const tick = () => {
    const moved = measure();
    checkOverlays();
    still = moved || document.getAnimations().some(ends) ? 0 : still + 1;
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

let easing = false;
const easeListeners = new Set<(phase: 'play' | 'end') => void>();

/**
 * A Zen switch is about to change every surface's size. Each takes its new
 * size at once (so it always fills its pane), its content held where it was
 * (`easeHold` natively) until `playSurfaceEase`, then eased on the page's
 * spring. Resizing during the motion made PDFKit lay out on the main thread
 * that also composites the page, and it froze.
 */
export function beginSurfaceEase() {
  easing = true;
}

/** The page's motion starts: the held content eases with it. */
export function playSurfaceEase() {
  easeListeners.forEach((listener) => listener('play'));
}

/** The switch is over: anything held is put where it belongs. */
export function endSurfaceEase() {
  easing = false;
  easeListeners.forEach((listener) => listener('end'));
  // The host's colour goes back to the window's (`seeThrough`).
  refreshers.forEach((refresh) => refresh());
}

/** Whether a surface's next size change is a switch's (`beginSurfaceEase`). */
export function surfaceEasing(): boolean {
  return easing;
}

/** Each surface listens for the switch's phases while it's open. */
export function onSurfaceEase(listener: (phase: 'play' | 'end') => void): () => void {
  easeListeners.add(listener);
  return () => easeListeners.delete(listener);
}

/**
 * Web content over a surface moved in a way nothing watched sees (a dragged
 * badge's `translate`): measure again for a few frames, so its touches stay
 * the webview's where it now is.
 */
export function overSurfaceMoved() {
  kickSurfaces();
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

/** What each surface reports, by its id. */
export const useSurfaceStates = create<Record<string, { error?: string }>>(() => ({}));

function onSurfaceEvent(event: SurfaceEvent) {
  const state = useSurfaceStates.getState()[event.id] ?? {};
  switch (event.type) {
    case 'saved':
      // Its own save: not a change from outside to reload. Synced soon, or
      // at once when the file was left.
      void commands.fileWritten(event.path, event.final ?? false);
      if (state.error) useSurfaceStates.setState({ [event.id]: { ...state, error: undefined } });
      break;
    case 'error':
      console.error('[native]', event.path, event.message);
      useSurfaceStates.setState({ [event.id]: { ...state, error: event.message } });
      break;
  }
}

/** How long focus may be away before the tools come back: moving it from one field to the next passes through none. */
const WEB_BLUR_GRACE_MS = 150;

/**
 * Tells the native side when web text has focus (`webFocus`): the tool
 * picker goes while it does, and comes back after.
 */
function followWebFocus(): () => void {
  let sent = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const update = (focused: boolean) => {
    clearTimeout(timer);
    if (focused === sent) return;
    const send = () => {
      sent = focused;
      void nativeSurfaces.webFocus(focused);
    };
    if (focused) send();
    else timer = setTimeout(send, WEB_BLUR_GRACE_MS);
  };
  update(!!useEditingFocus.getState().element);
  const unsubscribe = useEditingFocus.subscribe((s) => update(!!s.element));
  return () => {
    clearTimeout(timer);
    unsubscribe();
    if (sent) void nativeSurfaces.webFocus(false);
  };
}

function startHost(): () => void {
  const root = document.documentElement;
  root.dataset.nativeHost = '';
  const listening = nativeSurfaces.listen(onSurfaceEvent);
  const stopFocus = followWebFocus();
  const stopInk = followInkTools();
  void nativeSurfaces.ink({
    scratchOut: getSetting('ink.scratchOut'),
    darkPaper: getSetting('ink.darkPaper'),
    paper: themeGround() ?? undefined,
  });
  const stopScratch = subscribeToSetting('ink.scratchOut', (scratchOut) => void nativeSurfaces.ink({ scratchOut }));
  const stopPaper = subscribeToSetting('ink.darkPaper', (darkPaper) => void nativeSurfaces.ink({ darkPaper }));
  const theme = new MutationObserver(() => {
    // The ground follows the theme (`Paper.ground`), like the host's colour.
    const ground = themeGround();
    if (ground) void nativeSurfaces.ink({ paper: ground });
    refreshers.forEach((refresh) => refresh());
  });
  theme.observe(root, { attributes: true, attributeFilter: ['data-theme', 'data-islands', 'class', 'style'] });

  return () => {
    stopFocus();
    stopInk();
    stopScratch();
    stopPaper();
    theme.disconnect();
    void listening.then((listener) => listener.unregister());
    delete root.dataset.nativeHost;
    if (modal || sentRects !== '[]') {
      modal = false;
      sentRects = '[]';
      void nativeSurfaces.overlays(false, []);
    }
  };
}

/** The window's colour under Islands: the sidebar's, whatever the theme. */
function windowColour(): number[] | null {
  return cssColour('--sidebar');
}

/** The ground dark paper takes (`ink.darkPaper`): the theme's own background. */
function themeGround(): number[] | null {
  return cssColour('--background');
}

/** A theme variable as sRGB, by painting it with it; none if it doesn't resolve. */
function cssColour(variable: string): number[] | null {
  const probe = document.createElement('div');
  probe.style.display = 'none';
  probe.style.backgroundColor = `var(${variable})`;
  document.body.append(probe);
  const colour = getComputedStyle(probe).backgroundColor;
  probe.remove();
  return toRgb(colour);
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
