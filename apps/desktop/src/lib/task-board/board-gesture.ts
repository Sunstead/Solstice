import { haptics } from '@/lib/haptics';
import { cardTarget, columnTarget, type ColumnLayout } from './drop-target';
import type { CardRef } from './parse';

/**
 * Picking up a card, or a column by its header, as holding a tab or an ink
 * slot does (`tab-gesture.ts`, `slot-gesture.ts`):
 *
 *   touch/pen: press ─ hold ─▶ lift (haptic tick)
 *                               ├─ move  ─▶ drag: a ghost follows, a mark shows where it lands
 *                               └─ still ─▶ its menu
 *   mouse:     press ─ move ─▶ drag at once; a right click is the menu
 *
 * A finger that moves before the lift is scrolling the board, and a quick
 * press is a tap (the element's own click). Near an edge while dragging, the
 * board scrolls sideways and the column under the pointer up or down; on a
 * phone (`paged`) a pause at the side turns to the next column.
 *
 * The DOM it reads: `[data-column-index]` columns, each with a
 * `[data-column-handle]` header, `[data-card]` cards (their index in the
 * column) and optionally a `[data-column-scroll]` list; the root scrolls
 * sideways. Marks: `data-lifted` on what's held, `data-drop` (`before`,
 * `after`, `end`) where it would land, `[data-board-ghost]` under the pointer.
 */

const HOLD_MS = 300;
const STILL_MS = 250;
/** A press that moves this far before lifting is the board being scrolled. */
const SLOP_PX = 10;
/** A lifted card (or a pressed mouse) that moves this far is being dragged. */
const DRAG_PX = 6;
/** How near an edge the pointer scrolls, and the fastest it goes per frame. */
const EDGE_PX = 48;
const SPEED_PX = 14;
/** How long the pointer rests at the side before a paged board turns. */
const PAGE_MS = 450;

export type BoardTarget = { kind: 'card'; ref: CardRef } | { kind: 'column'; column: number };

export type BoardGestureOptions = {
  moveCard: (from: CardRef, to: CardRef) => void;
  moveColumn: (from: number, to: number) => void;
  /** A card's or column's menu, where the pointer is. */
  menu: (target: BoardTarget, at: { x: number; y: number }) => void;
  /** A column to a screen, snapping (the phone layout). */
  paged?: boolean;
};

const IGNORED = 'input, textarea, select, button, a[href], [contenteditable="true"], [data-board-ignore]';

/** The card or column header an event landed on, if a press there picks it up. */
function pressable(target: EventTarget | null): { el: HTMLElement; target: BoardTarget } | null {
  const element = target as Element | null;
  if (!element?.closest || element.closest(IGNORED)) return null;
  const column = element.closest<HTMLElement>('[data-column-index]');
  if (!column) return null;
  const columnIndex = Number(column.dataset.columnIndex);
  const card = element.closest<HTMLElement>('[data-card]');
  if (card && column.contains(card)) {
    return { el: card, target: { kind: 'card', ref: { column: columnIndex, card: Number(card.dataset.card) } } };
  }
  const handle = element.closest<HTMLElement>('[data-column-handle]');
  if (handle && column.contains(handle)) return { el: handle, target: { kind: 'column', column: columnIndex } };
  return null;
}

const box = (el: Element) => {
  const r = el.getBoundingClientRect();
  return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
};

/** Everything a press does, outside React so a test can drive it with events. Returns a stop. */
export function createBoardGesture(root: HTMLElement, { moveCard, moveColumn, menu, paged = false }: BoardGestureOptions): () => void {
  let press: {
    el: HTMLElement;
    target: BoardTarget;
    mouse: boolean;
    x: number;
    y: number;
    pointerId: number;
    lifted: boolean;
    dragging: boolean;
    menuOpened: boolean;
    ghost: HTMLElement | null;
    lastX: number;
    lastY: number;
    /** Where it lands: a card's ref or a column's index. */
    to: CardRef | number | null;
  } | null = null;
  let holdTimer = 0;
  let stillTimer = 0;
  let frame = 0;
  let pageTimer = 0;
  /** After a lift or drag, the click that follows the release mustn't open anything. */
  let swallowClick = false;

  const columns = () =>
    [...root.querySelectorAll<HTMLElement>('[data-column-index]')].sort(
      (a, b) => Number(a.dataset.columnIndex) - Number(b.dataset.columnIndex),
    );
  const cardsOf = (column: HTMLElement) =>
    [...column.querySelectorAll<HTMLElement>('[data-card]')].filter((card) => card.closest('[data-column-index]') === column);

  const clearMarks = () => {
    for (const el of root.querySelectorAll<HTMLElement>('[data-drop]')) delete el.dataset.drop;
  };

  const reset = () => {
    clearTimeout(holdTimer);
    clearTimeout(stillTimer);
    clearTimeout(pageTimer);
    pageTimer = 0;
    cancelAnimationFrame(frame);
    frame = 0;
    clearMarks();
    if (press) {
      delete press.el.dataset.lifted;
      press.ghost?.remove();
    }
    press = null;
  };

  const openMenu = () => {
    if (!press || press.dragging || press.menuOpened) return;
    press.menuOpened = true;
    menu(press.target, { x: press.lastX, y: press.lastY });
  };

  const lift = () => {
    if (!press) return;
    press.lifted = true;
    press.el.dataset.lifted = '';
    try {
      root.setPointerCapture?.(press.pointerId);
    } catch {
      // A pointer already gone: the release that follows resets.
    }
  };

  /** Where the held thing would land under the pointer, marked on the board. */
  const track = () => {
    if (!press?.dragging) return;
    const all = columns();
    const layout: ColumnLayout[] = all.map((column) => ({ box: box(column), cards: cardsOf(column).map(box) }));
    clearMarks();
    const { target } = press;
    if (target.kind === 'card') {
      const to = cardTarget(layout, { x: press.lastX, y: press.lastY }, target.ref);
      if (to && press.to !== null && !sameRef(to, press.to)) haptics.play('tick');
      press.to = to;
      if (!to) return;
      const others = cardsOf(all[to.column]).filter((_, i) => !(to.column === target.ref.column && i === target.ref.card));
      if (to.card < others.length) others[to.card].dataset.drop = 'before';
      else all[to.column].dataset.drop = 'end';
    } else {
      const from = target.column;
      const centre = (layout[from].box.left + layout[from].box.right) / 2;
      const to = columnTarget(layout, from, centre + press.lastX - press.x);
      if (press.to !== null && to !== press.to) haptics.play('tick');
      press.to = to;
      const others = all.filter((_, i) => i !== from);
      if (to === from || others.length === 0) return;
      if (to < others.length) others[to].dataset.drop = 'before';
      else others[others.length - 1].dataset.drop = 'after';
    }
  };

  /** Scrolls toward an edge the pointer is near; returns whether anything moved. */
  const scrollEdges = (): boolean => {
    if (!press) return false;
    let moved = false;
    const sideways = root.getBoundingClientRect();
    const side = edge(press.lastX, sideways.left, sideways.right);
    if (side !== 0 && root.scrollWidth > root.clientWidth) {
      if (paged) {
        if (!pageTimer) {
          pageTimer = window.setTimeout(() => {
            pageTimer = 0;
            const page = columns()[0]?.getBoundingClientRect().width || root.clientWidth;
            root.scrollBy({ left: Math.sign(side) * page, behavior: 'smooth' });
          }, PAGE_MS);
        }
      } else {
        root.scrollLeft += side * SPEED_PX;
        moved = true;
      }
    } else if (pageTimer) {
      clearTimeout(pageTimer);
      pageTimer = 0;
    }
    if (press.target.kind === 'card') {
      const column = columns().find((c) => {
        const r = c.getBoundingClientRect();
        return press!.lastX >= r.left && press!.lastX <= r.right;
      });
      const list = column?.querySelector<HTMLElement>('[data-column-scroll]');
      if (list && list.scrollHeight > list.clientHeight) {
        const r = list.getBoundingClientRect();
        const upDown = edge(press.lastY, r.top, r.bottom);
        if (upDown !== 0) {
          list.scrollTop += upDown * SPEED_PX;
          moved = true;
        }
      }
    }
    return moved;
  };

  const tick = () => {
    frame = 0;
    if (!press?.dragging) return;
    if (scrollEdges()) track();
    frame = requestAnimationFrame(tick);
  };

  const startDrag = () => {
    if (!press) return;
    press.dragging = true;
    window.getSelection()?.removeAllRanges();
    clearTimeout(stillTimer);
    if (!press.lifted) lift();
    const rect = press.el.getBoundingClientRect();
    const ghost = press.el.cloneNode(true) as HTMLElement;
    ghost.dataset.boardGhost = '';
    delete ghost.dataset.lifted;
    Object.assign(ghost.style, {
      position: 'fixed',
      left: `${rect.left}px`,
      top: `${rect.top}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
      margin: '0',
      pointerEvents: 'none',
      zIndex: '60',
    });
    document.body.append(ghost);
    press.ghost = ghost;
    frame = requestAnimationFrame(tick);
  };

  const onDown = (event: PointerEvent) => {
    if (event.button !== 0) return;
    const hit = pressable(event.target);
    if (!hit) return;
    reset();
    swallowClick = false;
    const mouse = event.pointerType === 'mouse';
    press = {
      ...hit,
      mouse,
      x: event.clientX,
      y: event.clientY,
      pointerId: event.pointerId,
      lifted: false,
      dragging: false,
      menuOpened: false,
      ghost: null,
      lastX: event.clientX,
      lastY: event.clientY,
      to: null,
    };
    if (mouse) return;
    haptics.prepare();
    holdTimer = window.setTimeout(() => {
      if (!press) return;
      lift();
      haptics.play('lift');
      stillTimer = window.setTimeout(openMenu, STILL_MS);
    }, HOLD_MS);
  };

  const onMove = (event: PointerEvent) => {
    if (!press || event.pointerId !== press.pointerId || press.menuOpened) return;
    press.lastX = event.clientX;
    press.lastY = event.clientY;
    const dx = event.clientX - press.x;
    const dy = event.clientY - press.y;
    if (!press.mouse && !press.lifted) {
      if (Math.abs(dx) > SLOP_PX || Math.abs(dy) > SLOP_PX) reset();
      return;
    }
    if (!press.dragging) {
      if (Math.hypot(dx, dy) < DRAG_PX) return;
      startDrag();
    }
    if (press.ghost) press.ghost.style.transform = `translate(${dx}px, ${dy}px)`;
    track();
  };

  const onUp = (event: PointerEvent) => {
    if (!press || event.pointerId !== press.pointerId) return;
    const { lifted, dragging, target, to } = press;
    if (dragging) {
      if (target.kind === 'card' && to !== null && typeof to === 'object' && !sameRef(to, target.ref)) {
        haptics.play('drop');
        moveCard(target.ref, to);
      } else if (target.kind === 'column' && typeof to === 'number' && to !== target.column) {
        haptics.play('drop');
        moveColumn(target.column, to);
      }
    } else if (lifted) openMenu();
    swallowClick = lifted || dragging;
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
    const hit = pressable(event.target);
    if (!hit) return;
    event.preventDefault();
    reset();
    menu(hit.target, { x: event.clientX, y: event.clientY });
  };

  // What's held is dragged, not the board scrolled.
  const onTouchMove = (event: TouchEvent) => {
    if (press?.lifted) event.preventDefault();
  };

  // The system's own drag would race the hold (as it did for tabs).
  const onDragStart = (event: DragEvent) => {
    if (pressable(event.target)) event.preventDefault();
  };

  // A card being dragged shouldn't select the text under the pointer.
  const onSelectStart = (event: Event) => {
    // The target is a text node when the press lands on text.
    const node = event.target as Node | null;
    if (press && pressable(node instanceof Element ? node : (node?.parentElement ?? null))) event.preventDefault();
  };

  root.addEventListener('pointerdown', onDown);
  root.addEventListener('selectstart', onSelectStart);
  root.addEventListener('pointermove', onMove);
  root.addEventListener('pointerup', onUp);
  root.addEventListener('pointercancel', onCancel);
  root.addEventListener('click', onClick, true);
  root.addEventListener('contextmenu', onContextMenu);
  root.addEventListener('touchmove', onTouchMove, { passive: false });
  root.addEventListener('dragstart', onDragStart);
  return () => {
    reset();
    root.removeEventListener('pointerdown', onDown);
    root.removeEventListener('selectstart', onSelectStart);
    root.removeEventListener('pointermove', onMove);
    root.removeEventListener('pointerup', onUp);
    root.removeEventListener('pointercancel', onCancel);
    root.removeEventListener('click', onClick, true);
    root.removeEventListener('contextmenu', onContextMenu);
    root.removeEventListener('touchmove', onTouchMove);
    root.removeEventListener('dragstart', onDragStart);
  };
}

function sameRef(a: CardRef, b: CardRef | number | null): boolean {
  return b !== null && typeof b === 'object' && a.column === b.column && a.card === b.card;
}

/** -1 to 1: how far into the edge band `at` is, toward the start or the end. */
function edge(at: number, start: number, end: number): number {
  if (at < start + EDGE_PX) return -Math.min(1, (start + EDGE_PX - at) / EDGE_PX);
  if (at > end - EDGE_PX) return Math.min(1, (at - (end - EDGE_PX)) / EDGE_PX);
  return 0;
}
