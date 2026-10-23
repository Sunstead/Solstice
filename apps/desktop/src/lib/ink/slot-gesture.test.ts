// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const play = vi.hoisted(() => vi.fn());
vi.mock('@/lib/haptics', () => ({ haptics: { play, prepare: vi.fn() } }));

import { createSlotGesture } from './slot-gesture';

const WIDTH = 40;

// A row of four slots, 40px apiece, from x=0.
describe('createSlotGesture', () => {
  let row: HTMLDivElement;
  let slots: HTMLButtonElement[];
  let move: ReturnType<typeof vi.fn>;
  let menu: ReturnType<typeof vi.fn>;
  let stop: () => void;

  const fire = (target: Element, type: string, x: number, init: PointerEventInit = {}) =>
    target.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        pointerId: 1,
        pointerType: 'touch',
        clientX: x,
        ...init,
      }),
    );

  beforeEach(() => {
    vi.useFakeTimers();
    row = document.createElement('div');
    slots = [0, 1, 2, 3].map((i) => {
      const slot = document.createElement('button');
      slot.dataset.slotIndex = String(i);
      slot.getBoundingClientRect = () => new DOMRect(i * WIDTH, 0, WIDTH, WIDTH);
      row.append(slot);
      return slot;
    });
    document.body.append(row);
    move = vi.fn();
    menu = vi.fn();
    stop = createSlotGesture(row, { move, menu });
  });

  afterEach(() => {
    stop();
    row.remove();
    vi.useRealTimers();
    play.mockClear();
  });

  it('leaves a quick press to the click', () => {
    fire(slots[1], 'pointerdown', 60);
    vi.advanceTimersByTime(100);
    fire(slots[1], 'pointerup', 60);
    const click = new MouseEvent('click', { bubbles: true, cancelable: true });
    slots[1].dispatchEvent(click);
    expect(click.defaultPrevented).toBe(false);
    expect(menu).not.toHaveBeenCalled();
  });

  it('lets a press that moves first scroll the row', () => {
    fire(slots[1], 'pointerdown', 60);
    fire(slots[1], 'pointermove', 90);
    vi.advanceTimersByTime(1000);
    expect(play).not.toHaveBeenCalled();
    expect(menu).not.toHaveBeenCalled();
  });

  it('opens the menu on a hold kept still, and swallows the click after', () => {
    fire(slots[2], 'pointerdown', 100);
    vi.advanceTimersByTime(350);
    expect(play).toHaveBeenCalledWith('lift');
    vi.advanceTimersByTime(250);
    expect(menu).toHaveBeenCalledWith(2, expect.any(DOMRect));
    fire(slots[2], 'pointerup', 100);
    expect(menu).toHaveBeenCalledTimes(1);
    const click = new MouseEvent('click', { bubbles: true, cancelable: true });
    slots[2].dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);
  });

  it('opens the menu when let go just after lifting', () => {
    fire(slots[0], 'pointerdown', 20);
    vi.advanceTimersByTime(360);
    fire(slots[0], 'pointerup', 20);
    expect(menu).toHaveBeenCalledWith(0, expect.any(DOMRect));
  });

  it('reorders a lifted slot that moves, never opening the menu', () => {
    fire(slots[0], 'pointerdown', 20);
    vi.advanceTimersByTime(350);
    fire(slots[0], 'pointermove', 30);
    fire(slots[0], 'pointermove', 105);
    expect(slots[0].style.transform).toBe('translateX(85px)');
    expect(slots[1].style.transform).toBe(`translateX(${-WIDTH}px)`);
    expect(slots[2].style.transform).toBe(`translateX(${-WIDTH}px)`);
    vi.advanceTimersByTime(1000);
    fire(slots[0], 'pointerup', 105);
    expect(move).toHaveBeenCalledWith(0, 2);
    expect(menu).not.toHaveBeenCalled();
    expect(slots.every((s) => s.style.transform === '')).toBe(true);
  });

  it('opens the menu on a right click', () => {
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    slots[3].dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(menu).toHaveBeenCalledWith(3, expect.any(DOMRect));
  });
});

describe('createSlotGesture in a grid', () => {
  let grid: HTMLDivElement;
  let items: HTMLDivElement[];
  let move: ReturnType<typeof vi.fn>;
  let menu: ReturnType<typeof vi.fn>;
  let stop: () => void;

  const fire = (target: Element, type: string, x: number, y: number) =>
    target.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        pointerId: 1,
        pointerType: 'touch',
        clientX: x,
        clientY: y,
      }),
    );

  // Two across, two down, 100 apart.
  beforeEach(() => {
    vi.useFakeTimers();
    grid = document.createElement('div');
    items = [0, 1, 2, 3].map((i) => {
      const item = document.createElement('div');
      item.dataset.slotIndex = String(i);
      item.getBoundingClientRect = () => new DOMRect((i % 2) * 100, Math.floor(i / 2) * 100, 100, 100);
      grid.append(item);
      return item;
    });
    document.body.append(grid);
    move = vi.fn();
    menu = vi.fn();
    stop = createSlotGesture(grid, { move, menu, grid: true });
  });

  afterEach(() => {
    stop();
    grid.remove();
    vi.useRealTimers();
  });

  it('drops a lifted item on the nearest slot, down as well as across', () => {
    fire(items[0], 'pointerdown', 50, 50);
    vi.advanceTimersByTime(350);
    fire(items[0], 'pointermove', 60, 60);
    fire(items[0], 'pointermove', 150, 140);
    expect(items[0].style.transform).toBe('translate(100px, 90px)');
    expect(items[3].dataset.dropTarget).toBe('');
    expect(items[1].style.transform).toBe('');
    fire(items[0], 'pointerup', 150, 140);
    expect(move).toHaveBeenCalledWith(0, 3);
    expect(menu).not.toHaveBeenCalled();
    expect(items[3].dataset.dropTarget).toBeUndefined();
  });

  it('lets a press that moves down first scroll the grid', () => {
    fire(items[0], 'pointerdown', 50, 50);
    fire(items[0], 'pointermove', 50, 80);
    vi.advanceTimersByTime(1000);
    expect(menu).not.toHaveBeenCalled();
  });

  it('opens the menu on a hold kept still', () => {
    fire(items[2], 'pointerdown', 50, 150);
    vi.advanceTimersByTime(600);
    expect(menu).toHaveBeenCalledWith(2, expect.any(DOMRect));
  });
});

// A 2×2 flow (bookmarks): 100px columns, 50px rows, dragged at once by a mouse.
describe('createSlotGesture in a flow, with a mouse', () => {
  let row: HTMLDivElement;
  let slots: HTMLElement[];
  let move: ReturnType<typeof vi.fn>;
  let menu: ReturnType<typeof vi.fn>;
  let stop: () => void;

  const fire = (target: Element, type: string, x: number, y: number) =>
    target.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        pointerId: 1,
        pointerType: 'mouse',
        clientX: x,
        clientY: y,
      }),
    );

  beforeEach(() => {
    row = document.createElement('div');
    slots = [0, 1, 2, 3].map((i) => {
      const slot = document.createElement('div');
      slot.dataset.slotIndex = String(i);
      slot.getBoundingClientRect = () => new DOMRect((i % 2) * 100, Math.floor(i / 2) * 50, 100, 50);
      row.append(slot);
      return slot;
    });
    document.body.append(row);
    move = vi.fn();
    menu = vi.fn();
    stop = createSlotGesture(row, { move, menu, flow: true, mouseDrag: true });
  });

  afterEach(() => {
    stop();
    row.remove();
    play.mockClear();
  });

  it('drags at once, the others making way, and drops', () => {
    fire(slots[0], 'pointerdown', 50, 25);
    fire(slots[0], 'pointermove', 60, 40);
    expect(slots[0].dataset.lifted).toBe('');
    fire(slots[0], 'pointermove', 50, 75);
    expect(slots[0].style.transform).toBe('translate(0px, 50px)');
    expect(slots[1].style.transform).toBe('translate(-100px, 0px)');
    expect(slots[2].style.transform).toBe('translate(100px, -50px)');
    fire(slots[0], 'pointerup', 50, 75);
    expect(move).toHaveBeenCalledWith(0, 2);
    expect(menu).not.toHaveBeenCalled();
    const click = new MouseEvent('click', { bubbles: true, cancelable: true });
    slots[0].dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);
  });

  it('a mouse click is still a click', () => {
    fire(slots[1], 'pointerdown', 150, 25);
    fire(slots[1], 'pointerup', 151, 25);
    const click = new MouseEvent('click', { bubbles: true, cancelable: true });
    slots[1].dispatchEvent(click);
    expect(click.defaultPrevented).toBe(false);
    expect(move).not.toHaveBeenCalled();
  });
});
