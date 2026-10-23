import { haptics } from '@/lib/haptics';
import { shifts, targetIndex } from '@/lib/tab-reorder';
import { flowOffsets, gridTarget, type Point } from './pages';

/**
 * Holding a tool slot in the ink ribbon, as holding a tab does
 * (`tab-gesture.ts`), iPadOS's gesture for anything that drags and has a
 * menu:
 *
 *   press ─ hold ─▶ lift (haptic tick)
 *                    ├─ move  ─▶ reorder: the slot follows, the others make way
 *                    └─ still ─▶ its menu
 *
 * Moving before the lift is the row scrolling, and a quick press is a tap
 * (the slot's own click). A right click opens the menu too.
 *
 * In a `grid` (the page sheet's thumbnails) the lifted item follows the
 * finger both ways and drops on the nearest slot (`data-drop-target`), the
 * others staying put. In a `flow` (bookmarks: a list that may wrap into
 * columns) it follows both ways too and the others make way, as in a row.
 *
 * With `mouseDrag`, a mouse needs no hold: it drags once it moves, as
 * anything draggable on a computer does, and a click stays a click.
 */

const HOLD_MS = 350;
const STILL_MS = 250;
/** A press that moves this far before lifting is the row being scrolled. */
const SLOP_PX = 10;
/** A lifted slot that moves this far is being dragged. */
const DRAG_PX = 6;

export type SlotGestureOptions = {
  /** A slot was dragged from one index to another. */
  move: (from: number, to: number) => void;
  /** A slot's menu, at its rect. */
  menu: (index: number, rect: DOMRect) => void;
  /** A grid rather than a row. */
  grid?: boolean;
  /** A list that may wrap, rather than a row. */
  flow?: boolean;
  /** A mouse drags without holding first. */
  mouseDrag?: boolean;
};

const slotAt = (target: EventTarget | null) => (target as Element | null)?.closest?.<HTMLElement>('[data-slot-index]');

/** Everything a hold does, outside React so a test can drive it with events. Returns a stop. */
export function createSlotGesture(
  row: HTMLElement,
  { move, menu, grid = false, flow = false, mouseDrag = false }: SlotGestureOptions,
): () => void {
  let press: {
    slot: HTMLElement;
    index: number;
    x: number;
    y: number;
    pointerId: number;
    lifted: boolean;
    dragging: boolean;
    menuOpened: boolean;
    to: number;
    centres: number[];
    points: Point[];
    width: number;
    mouse: boolean;
  } | null = null;
  let holdTimer = 0;
  let stillTimer = 0;
  /** After a lift, the click that follows the release mustn't select the slot. */
  let swallowClick = false;

  const slots = () => [...row.querySelectorAll<HTMLElement>('[data-slot-index]')];

  const reset = () => {
    clearTimeout(holdTimer);
    clearTimeout(stillTimer);
    for (const el of slots()) {
      el.style.transform = '';
      delete el.dataset.lifted;
      delete el.dataset.dropTarget;
    }
    press = null;
  };

  const openMenu = () => {
    if (!press || press.dragging || press.menuOpened) return;
    press.menuOpened = true;
    const { index, slot } = press;
    menu(index, slot.getBoundingClientRect());
  };

  const onDown = (event: PointerEvent) => {
    if (event.button !== 0) return;
    const slot = slotAt(event.target);
    if (!slot) return;
    reset();
    swallowClick = false;
    press = {
      slot,
      index: Number(slot.dataset.slotIndex),
      x: event.clientX,
      y: event.clientY,
      pointerId: event.pointerId,
      lifted: false,
      dragging: false,
      menuOpened: false,
      to: Number(slot.dataset.slotIndex),
      centres: [],
      points: [],
      width: 0,
      mouse: mouseDrag && event.pointerType === 'mouse',
    };
    // A mouse lifts when it moves (`onMove`); its menu is the right click.
    if (press.mouse) return;
    holdTimer = window.setTimeout(() => {
      if (!press) return;
      lift();
      haptics.play('lift');
      stillTimer = window.setTimeout(openMenu, STILL_MS);
    }, HOLD_MS);
  };

  const lift = () => {
    if (!press) return;
    press.lifted = true;
    press.points = slots().map((el) => {
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    press.centres = press.points.map((p) => p.x);
    const all = slots();
    press.width = all.length > 1 ? press.centres[1] - press.centres[0] : press.slot.getBoundingClientRect().width;
    press.slot.dataset.lifted = '';
    row.setPointerCapture?.(press.pointerId);
  };

  const onMove = (event: PointerEvent) => {
    if (!press || event.pointerId !== press.pointerId || press.menuOpened) return;
    const dx = event.clientX - press.x;
    const dy = grid || flow ? event.clientY - press.y : 0;
    const distance = Math.hypot(dx, dy);
    if (!press.lifted && press.mouse) {
      if (distance < DRAG_PX) return;
      lift();
    }
    if (!press.lifted) {
      if (Math.abs(dx) > SLOP_PX || Math.abs(event.clientY - press.y) > SLOP_PX) reset();
      return;
    }
    if (!press.dragging && distance < DRAG_PX) return;
    if (!press.dragging) {
      press.dragging = true;
      clearTimeout(stillTimer);
    }
    const { index, centres, width, points } = press;
    if (grid) {
      const to = gridTarget(points, { x: points[index].x + dx, y: points[index].y + dy });
      if (to !== press.to) haptics.play('tick');
      press.to = to;
      slots().forEach((el, i) => {
        el.style.transform = i === index ? `translate(${dx}px, ${dy}px)` : '';
        if (i === to && i !== index) el.dataset.dropTarget = '';
        else delete el.dataset.dropTarget;
      });
      return;
    }
    if (flow) {
      const to = gridTarget(points, { x: points[index].x + dx, y: points[index].y + dy });
      if (to !== press.to) haptics.play('tick');
      press.to = to;
      const offsets = flowOffsets(points, index, to);
      slots().forEach((el, i) => {
        const { x, y } = i === index ? { x: dx, y: dy } : offsets[i];
        el.style.transform = x || y ? `translate(${x}px, ${y}px)` : '';
      });
      return;
    }
    const to = targetIndex(centres, index, centres[index] + dx);
    if (to !== press.to) haptics.play('tick');
    press.to = to;
    const offsets = shifts(centres.length, index, to, width);
    slots().forEach((el, i) => {
      el.style.transform = i === index ? `translateX(${dx}px)` : offsets[i] ? `translateX(${offsets[i]}px)` : '';
    });
  };

  const onUp = (event: PointerEvent) => {
    if (!press || event.pointerId !== press.pointerId) return;
    const { lifted, dragging, index, to } = press;
    if (dragging && to !== index) {
      haptics.play('drop');
      move(index, to);
    } else if (lifted && !dragging) openMenu();
    swallowClick = lifted;
    reset();
  };

  const onCancel = () => reset();

  const onClick = (event: MouseEvent) => {
    if (!swallowClick) return;
    swallowClick = false;
    event.preventDefault();
    event.stopPropagation();
  };

  const onContextMenu = (event: MouseEvent) => {
    const slot = slotAt(event.target);
    if (!slot) return;
    event.preventDefault();
    reset();
    menu(Number(slot.dataset.slotIndex), slot.getBoundingClientRect());
  };

  // A lifted slot is dragged, not the row scrolled.
  const onTouchMove = (event: TouchEvent) => {
    if (press?.lifted) event.preventDefault();
  };

  row.addEventListener('pointerdown', onDown);
  row.addEventListener('pointermove', onMove);
  row.addEventListener('pointerup', onUp);
  row.addEventListener('pointercancel', onCancel);
  row.addEventListener('click', onClick, true);
  row.addEventListener('contextmenu', onContextMenu);
  row.addEventListener('touchmove', onTouchMove, { passive: false });
  return () => {
    reset();
    row.removeEventListener('pointerdown', onDown);
    row.removeEventListener('pointermove', onMove);
    row.removeEventListener('pointerup', onUp);
    row.removeEventListener('pointercancel', onCancel);
    row.removeEventListener('click', onClick, true);
    row.removeEventListener('contextmenu', onContextMenu);
    row.removeEventListener('touchmove', onTouchMove);
  };
}
