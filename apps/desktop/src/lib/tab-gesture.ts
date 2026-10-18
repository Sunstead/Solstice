import { useEffect, useRef } from 'react';
import { flushSync } from 'react-dom';
import { Actions, DockLocation, TabNode, TabSetNode, type Model } from 'flexlayout-react';

import { haptics } from '@/lib/haptics';
import { motionEnabled, roomOf } from '@/lib/tab-motion';
import { clamp, dropIndex, lag, shifts, targetIndex } from '@/lib/tab-reorder';

import type { TabMenuRequest } from '@/lib/tab-long-press';

/**
 * Holding a tab with a finger or the Pencil, the way iPadOS does it for
 * anything that both drags and has a menu (Safari's tabs, Files):
 *
 *   press ─ hold ─▶ lift (haptic tick, the tab rises under the finger)
 *                    ├─ move  ─▶ reorder: the tab follows, the others make way
 *                    └─ still ─▶ its menu opens beside the lifted tab
 *
 * Moving first is a drag and never opens the menu; holding still first is
 * the menu and never drags. The system's own HTML5 drag stays out of it: iOS
 * decides for itself when to lift and which of the two it prefers, so one
 * clock here decides. It applies where the strip is the layout's only one
 * (the iPad's one-tab-at-a-time layout, an unsplit window), where a drag can
 * only mean reordering; with panes a tab can be docked, and the system's drag
 * and `tab-long-press.ts` stay.
 */

/** How long a press must hold before the tab lifts. */
const LIFT_MS = 300;
/** How long a lifted tab must be still before its menu opens. */
const MENU_MS = 250;
/** A press that moves this far before lifting is the strip being panned. */
const PAN_SLOP = 8;
/** A lifted tab that moves this far is being dragged. */
const DRAG_SLOP = 6;
/** Apple's decelerating spring, as a curve. */
const SPRING = 'cubic-bezier(0.32, 0.72, 0, 1)';
const LIFTED_SCALE = 1.06;
/** A release that lifted is followed by clicks that mustn't select the tab. */
const SWALLOW_MS = 500;

const TAB = '.flexlayout__tab_button';
/** Ids on the animations that make way for the lifted tab. */
const SHIFT = 'tab-shift';

/** Whether the layout is a single strip of tabs, so a drag can only reorder. */
export function soleStrip(model: Model | null | undefined): boolean {
  if (!model) return false;
  let tabsets = 0;
  model.visitNodes((n) => {
    if (n instanceof TabSetNode) tabsets++;
  });
  return tabsets === 1;
}

/** Whether a tab's drag is ours: its strip is the layout's only one. */
export function ownsDrag(model: Model | null | undefined, tabId: string): boolean {
  const node = model?.getNodeById(tabId);
  return node instanceof TabNode && node.isEnableDrag() && soleStrip(model);
}

/** The tab a press landed on (not on its close button or a rename box). */
function tabAt(target: EventTarget | null): { button: HTMLElement; tabId: string } | null {
  const el = target as Element | null;
  if (el?.closest?.('.flexlayout__tab_button_trailing, input, textarea')) return null;
  const button = el?.closest?.<HTMLElement>(TAB);
  const tabId = button?.querySelector<HTMLElement>('[data-tab-id]')?.dataset.tabId;
  return button && tabId ? { button, tabId } : null;
}

function tabsIn(strip: Element): HTMLElement[] {
  return [...strip.children].filter((el): el is HTMLElement => el instanceof HTMLElement && el.matches(TAB));
}

/**
 * Eases to `to`, which is also set outright, so nothing waits on the
 * animation. Animations are matched by `id`, so a newer one replaces an older.
 */
function ease(el: HTMLElement, to: { translate?: string; scale?: string }, ms: number, id = ''): Promise<void> {
  const style = getComputedStyle(el);
  const from = { translate: style.translate, scale: style.scale };
  for (const a of el.getAnimations?.() ?? []) if (a.id === id) a.cancel();
  Object.assign(el.style, to);
  if (!motionEnabled() || typeof el.animate !== 'function') return Promise.resolve();
  const frames = [from, { translate: to.translate ?? from.translate, scale: to.scale ?? from.scale }];
  return el.animate(frames, { id, duration: ms, easing: SPRING }).finished.then(
    () => {},
    () => {},
  );
}

/** The lifted tab: a card under the finger, in place of the tab it left. */
function buildGhost(button: HTMLElement, rect: DOMRect, height: number): HTMLElement {
  const content = button.querySelector<HTMLElement>('.flexlayout__tab_button_content');
  const ghost = document.createElement('div');
  ghost.className = 'solstice-tab-ghost';
  ghost.setAttribute('aria-hidden', 'true');
  const lead = button.querySelector('.flexlayout__tab_button_leading');
  if (lead) ghost.append(lead.cloneNode(true));
  const label = document.createElement('span');
  label.className = 'solstice-tab-ghost-label';
  label.textContent = content?.textContent ?? '';
  ghost.append(label);
  if (content) ghost.style.font = getComputedStyle(content).font;
  ghost.style.width = `${rect.width}px`;
  ghost.style.height = `${height}px`;
  document.body.append(ghost);
  return ghost;
}

type Phase = 'pressed' | 'lifted' | 'dragging' | 'menu';

type Hold = {
  phase: Phase;
  pointerId: number;
  tabId: string;
  button: HTMLElement;
  start: { x: number; y: number };
  /** Set at the lift: the strip as it rested, and where the tab is headed. */
  strip?: {
    tabs: HTMLElement[];
    rects: DOMRect[];
    from: number;
    to: number;
    /** What one tab takes of the strip, margins included. */
    slot: number;
    ghost: HTMLElement;
    top: number;
    /** Reordering needs the strip's buttons to be the tabset's tabs, all of them. */
    reorder: boolean;
  };
};

export type TabGestureOptions = {
  model: () => Model | null | undefined;
  open: (request: TabMenuRequest) => void;
};

/** Everything a hold does, outside React so a test can drive it with events. */
export function createTabGesture({ model, open }: TabGestureOptions) {
  let hold: Hold | null = null;
  /** A lifted tab is still settling into its slot: no new hold until it has. */
  let settling = false;
  let liftTimer = 0;
  let menuTimer = 0;
  let swallowUntil = 0;

  const cancelTimers = () => {
    clearTimeout(liftTimer);
    clearTimeout(menuTimer);
  };

  /** The tab shown, the others at rest, the card gone. */
  const restore = (h: Hold) => {
    h.button.style.removeProperty('opacity');
    for (const tab of h.strip?.tabs ?? []) {
      for (const a of tab.getAnimations?.() ?? []) if (a.id === SHIFT) a.cancel();
      tab.style.removeProperty('translate');
    }
    h.strip?.ghost.remove();
  };

  const reset = () => {
    cancelTimers();
    const h = hold;
    hold = null;
    if (h) restore(h);
  };

  /** Sets the lifted tab down where it is (its menu closed, a drag was cut short). */
  const putDown = () => {
    const h = hold;
    if (!h?.strip) return reset();
    cancelTimers();
    hold = null;
    settling = true;
    void ease(h.strip.ghost, { scale: '1' }, 220).then(() => {
      settling = false;
      restore(h);
    });
  };

  const lift = () => {
    const h = hold;
    if (!h || h.phase !== 'pressed') return;
    const container = h.button.parentElement;
    const tabs = container ? tabsIn(container) : [];
    const from = tabs.indexOf(h.button);
    const rect = h.button.getBoundingClientRect();
    const node = model()?.getNodeById(h.tabId);
    const tabset = node?.getParent();
    const ids = tabs.map((t) => t.querySelector<HTMLElement>('[data-tab-id]')?.dataset.tabId);
    const reorder =
      tabset instanceof TabSetNode &&
      from >= 0 &&
      tabs.length > 1 &&
      tabset.getChildren().length === tabs.length &&
      tabset.getChildren().every((c, i) => c.getId() === ids[i]);

    const height = Math.min(rect.height, 32);
    const top = rect.top + (rect.height - height) / 2;
    const ghost = buildGhost(h.button, rect, height);
    ghost.style.translate = `${rect.left}px ${top}px`;
    h.phase = 'lifted';
    h.strip = {
      tabs,
      rects: tabs.map((t) => t.getBoundingClientRect()),
      from,
      to: from,
      slot: roomOf(h.button),
      ghost,
      top,
      reorder,
    };
    // The card stands in for the tab, which keeps its slot but isn't seen.
    h.button.style.opacity = '0';
    haptics.play('lift');
    void ease(ghost, { scale: String(LIFTED_SCALE) }, 240);
    menuTimer = window.setTimeout(openMenu, MENU_MS);
  };

  const openMenu = () => {
    const h = hold;
    if (!h?.strip || h.phase !== 'lifted') return;
    cancelTimers();
    h.phase = 'menu';
    const rect = h.strip.rects[h.strip.from] ?? h.button.getBoundingClientRect();
    // Below the lifted tab, where the finger isn't.
    open({ tabId: h.tabId, x: rect.left, y: rect.bottom + 6 });
  };

  const track = (h: Hold, x: number, y: number) => {
    const strip = h.strip!;
    const { rects, from } = strip;
    const width = rects[from].width;
    const left = clamp(rects[from].left + (x - h.start.x), rects[0].left - 8, rects[rects.length - 1].right - width + 8);
    strip.ghost.style.translate = `${left}px ${strip.top + lag(y - h.start.y)}px`;

    const centres = rects.map((r) => r.left + r.width / 2);
    const to = targetIndex(centres, from, left + width / 2);
    if (to === strip.to) return;
    strip.to = to;
    haptics.play('tick');
    const moves = shifts(strip.tabs.length, from, to, strip.slot);
    strip.tabs.forEach((tab, i) => {
      if (i !== from) void ease(tab, { translate: `${moves[i]}px` }, 240, SHIFT);
    });
  };

  const drop = (h: Hold) => {
    const strip = h.strip!;
    const { from, to, rects } = strip;
    // Its slot now: where the tab it swapped with rested, on that tab's far side.
    const left = to > from ? rects[to].right - rects[from].width : rects[to].left;
    hold = null;
    settling = true;
    void ease(strip.ghost, { translate: `${left}px ${strip.top}px`, scale: '1' }, 260).then(() => {
      settling = false;
      const m = model();
      const node = m?.getNodeById(h.tabId);
      const tabset = node?.getParent();
      if (m && tabset instanceof TabSetNode && to !== from) {
        // A moved tab keeps its selection, or hands it on as it left.
        const selected = tabset.getSelectedNode() === node;
        // Reordered and shown in one task, so nothing paints the old order.
        flushSync(() =>
          m.doAction(Actions.moveNode(h.tabId, tabset.getId(), DockLocation.CENTER, dropIndex(from, to), selected)),
        );
      }
      restore(h);
      haptics.play('drop');
    });
  };

  const onDown = (event: PointerEvent) => {
    if (hold) {
      // A second finger: no longer a hold.
      if (hold.phase !== 'menu') reset();
      return;
    }
    if (event.pointerType === 'mouse' || settling) return;
    const tab = tabAt(event.target);
    if (!tab || !ownsDrag(model(), tab.tabId)) return;
    hold = { phase: 'pressed', pointerId: event.pointerId, start: { x: event.clientX, y: event.clientY }, ...tab };
    haptics.prepare();
    liftTimer = window.setTimeout(lift, LIFT_MS);
  };

  const onMove = (event: PointerEvent) => {
    const h = hold;
    if (!h || event.pointerId !== h.pointerId) return;
    const moved = Math.hypot(event.clientX - h.start.x, event.clientY - h.start.y);
    if (h.phase === 'pressed' && moved > PAN_SLOP) return reset();
    if (h.phase === 'lifted' && moved > DRAG_SLOP && h.strip?.reorder) {
      cancelTimers();
      h.phase = 'dragging';
    }
    if (h.phase === 'dragging') track(h, event.clientX, event.clientY);
  };

  const onUp = (event: PointerEvent) => {
    const h = hold;
    if (!h || event.pointerId !== h.pointerId) return;
    if (h.phase === 'pressed') return reset();
    swallowUntil = performance.now() + SWALLOW_MS;
    if (h.phase === 'dragging') return drop(h);
    // Let go before the menu came: a hold all the same.
    if (h.phase === 'lifted') openMenu();
  };

  const onCancel = (event: PointerEvent) => {
    const h = hold;
    if (!h || event.pointerId !== h.pointerId) return;
    // The menu taking the screen cancels the touch under it; that's no abort.
    if (h.phase === 'menu') return;
    if (h.phase === 'dragging') return putDown();
    reset();
  };

  /** A lifted tab is held for us: the strip mustn't pan under the finger. */
  const onTouchMove = (event: TouchEvent) => {
    if (hold && hold.phase !== 'pressed' && event.cancelable) event.preventDefault();
  };

  /** No system drag of a tab, and a hold is no context click (flexlayout's menu). */
  const onSystem = (event: Event) => {
    if (!hold && performance.now() > swallowUntil) return;
    if (event.type === 'dragstart' && !tabAt(event.target)) return;
    event.preventDefault();
    event.stopPropagation();
  };

  /** What follows a release that lifted mustn't select the tab it came from. */
  const onClick = (event: Event) => {
    if (performance.now() > swallowUntil || !tabAt(event.target)) return;
    event.preventDefault();
    event.stopPropagation();
  };

  const listeners: [string, EventListener, AddEventListenerOptions][] = [
    ['pointerdown', onDown as EventListener, {}],
    ['pointermove', onMove as EventListener, {}],
    ['pointerup', onUp as EventListener, {}],
    ['pointercancel', onCancel as EventListener, {}],
    ['touchmove', onTouchMove as EventListener, { passive: false }],
    ['dragstart', onSystem, {}],
    ['contextmenu', onSystem, {}],
    ['mousedown', onClick, {}],
    ['mouseup', onClick, {}],
    ['click', onClick, {}],
  ];
  for (const [type, listener, options] of listeners) {
    window.addEventListener(type, listener, { ...options, capture: true });
  }

  return {
    /** The menu closed: the tab it was for is set down. */
    menuClosed: () => {
      if (hold?.phase === 'menu') putDown();
    },
    dispose: () => {
      for (const [type, listener] of listeners) window.removeEventListener(type, listener, { capture: true });
      reset();
    },
  };
}

/**
 * Hold a tab to lift it: drag to reorder, or keep still for its menu.
 * `menuOpen` is whether the menu `open` asked for is showing.
 */
export function useTabGesture(
  model: Model | null | undefined,
  open: (request: TabMenuRequest) => void,
  menuOpen: boolean,
) {
  const modelRef = useRef(model);
  const gesture = useRef<ReturnType<typeof createTabGesture> | null>(null);
  useEffect(() => {
    modelRef.current = model;
  }, [model]);
  useEffect(() => {
    const g = createTabGesture({ model: () => modelRef.current, open });
    gesture.current = g;
    return () => {
      g.dispose();
      gesture.current = null;
    };
  }, [open]);
  useEffect(() => {
    if (!menuOpen) gesture.current?.menuClosed();
  }, [menuOpen]);
}
