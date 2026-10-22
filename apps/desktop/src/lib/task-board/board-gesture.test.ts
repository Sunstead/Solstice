// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const play = vi.hoisted(() => vi.fn());
vi.mock('@/lib/haptics', () => ({ haptics: { play, prepare: vi.fn() } }));

import { createBoardGesture, type BoardGestureOptions } from './board-gesture';

// Two columns 200 wide, 20 apart; each header 40 tall, cards 50 tall from y=100.
describe('createBoardGesture', () => {
  let root: HTMLDivElement;
  let cards: HTMLElement[][];
  let handles: HTMLElement[];
  let options: { [K in keyof BoardGestureOptions]: ReturnType<typeof vi.fn> };
  let stop: () => void;

  const fire = (target: Element, type: string, x: number, y: number, init: PointerEventInit = {}) =>
    target.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        pointerId: 1,
        pointerType: 'touch',
        button: 0,
        clientX: x,
        clientY: y,
        ...init,
      }),
    );

  const clickOn = (target: Element) => {
    const click = new MouseEvent('click', { bubbles: true, cancelable: true });
    target.dispatchEvent(click);
    return click;
  };

  beforeEach(() => {
    vi.useFakeTimers();
    root = document.createElement('div');
    cards = [];
    handles = [];
    [2, 1].forEach((count, i) => {
      const column = document.createElement('div');
      column.dataset.columnIndex = String(i);
      column.getBoundingClientRect = () => new DOMRect(i * 220, 0, 200, 600);
      const handle = document.createElement('div');
      handle.dataset.columnHandle = '';
      handle.getBoundingClientRect = () => new DOMRect(i * 220, 0, 200, 40);
      column.append(handle);
      handles.push(handle);
      cards.push(
        Array.from({ length: count }, (_, c) => {
          const card = document.createElement('div');
          card.dataset.card = String(c);
          card.getBoundingClientRect = () => new DOMRect(i * 220, 100 + c * 60, 200, 50);
          const input = document.createElement('input');
          card.append(input);
          column.append(card);
          return card;
        }),
      );
      root.append(column);
    });
    document.body.append(root);
    options = { moveCard: vi.fn(), moveColumn: vi.fn(), menu: vi.fn() };
    stop = createBoardGesture(root, options as unknown as BoardGestureOptions);
  });

  afterEach(() => {
    stop();
    root.remove();
    vi.useRealTimers();
    play.mockClear();
  });

  it('leaves a quick tap to the click', () => {
    fire(cards[0][0], 'pointerdown', 50, 120);
    vi.advanceTimersByTime(100);
    fire(cards[0][0], 'pointerup', 50, 120);
    expect(clickOn(cards[0][0]).defaultPrevented).toBe(false);
    expect(options.menu).not.toHaveBeenCalled();
  });

  it('lets a finger that moves before the hold scroll', () => {
    fire(cards[0][0], 'pointerdown', 50, 120);
    fire(cards[0][0], 'pointermove', 50, 150);
    vi.advanceTimersByTime(1000);
    expect(play).not.toHaveBeenCalled();
    expect(options.menu).not.toHaveBeenCalled();
  });

  it('opens a card’s menu on a hold kept still, and swallows the click', () => {
    fire(cards[0][1], 'pointerdown', 50, 180);
    vi.advanceTimersByTime(300);
    expect(play).toHaveBeenCalledWith('lift');
    vi.advanceTimersByTime(250);
    expect(options.menu).toHaveBeenCalledWith({ kind: 'card', ref: { column: 0, card: 1 } }, { x: 50, y: 180 });
    fire(cards[0][1], 'pointerup', 50, 180);
    expect(options.menu).toHaveBeenCalledTimes(1);
    expect(clickOn(cards[0][1]).defaultPrevented).toBe(true);
  });

  it('drags a held card to another column, with a ghost and a drop mark', () => {
    fire(cards[0][0], 'pointerdown', 50, 120);
    vi.advanceTimersByTime(300);
    fire(cards[0][0], 'pointermove', 60, 125);
    fire(cards[0][0], 'pointermove', 300, 110);
    expect(document.querySelector('[data-board-ghost]')).not.toBeNull();
    expect(cards[0][0].dataset.lifted).toBe('');
    // Above the middle of column 1's only card.
    expect(cards[1][0].dataset.drop).toBe('before');
    fire(cards[0][0], 'pointermove', 300, 400);
    expect(cards[1][0].dataset.drop).toBeUndefined();
    expect(root.querySelector<HTMLElement>('[data-column-index="1"]')!.dataset.drop).toBe('end');
    vi.advanceTimersByTime(1000);
    fire(cards[0][0], 'pointerup', 300, 400);
    expect(options.moveCard).toHaveBeenCalledWith({ column: 0, card: 0 }, { column: 1, card: 1 });
    expect(options.menu).not.toHaveBeenCalled();
    expect(document.querySelector('[data-board-ghost]')).toBeNull();
    expect(root.querySelector('[data-drop]')).toBeNull();
    expect(cards[0][0].dataset.lifted).toBeUndefined();
  });

  it('does nothing for a card dropped where it was', () => {
    fire(cards[0][0], 'pointerdown', 50, 120);
    vi.advanceTimersByTime(300);
    fire(cards[0][0], 'pointermove', 60, 130);
    fire(cards[0][0], 'pointerup', 60, 130);
    expect(options.moveCard).not.toHaveBeenCalled();
  });

  it('drags with a mouse at once, no hold', () => {
    const mouse = { pointerType: 'mouse' };
    fire(cards[0][0], 'pointerdown', 50, 120, mouse);
    fire(cards[0][0], 'pointermove', 52, 121, mouse);
    expect(document.querySelector('[data-board-ghost]')).toBeNull();
    fire(cards[0][0], 'pointermove', 300, 90, mouse);
    fire(cards[0][0], 'pointerup', 300, 90, mouse);
    expect(options.moveCard).toHaveBeenCalledWith({ column: 0, card: 0 }, { column: 1, card: 0 });
    expect(play).not.toHaveBeenCalledWith('lift');
    expect(clickOn(cards[0][0]).defaultPrevented).toBe(true);
  });

  it('never opens a menu from a mouse held still', () => {
    fire(cards[0][0], 'pointerdown', 50, 120, { pointerType: 'mouse' });
    vi.advanceTimersByTime(1000);
    expect(options.menu).not.toHaveBeenCalled();
  });

  it('reorders columns by their header', () => {
    fire(handles[1], 'pointerdown', 300, 20);
    vi.advanceTimersByTime(300);
    fire(handles[1], 'pointermove', 290, 20);
    fire(handles[1], 'pointermove', 50, 20);
    expect(root.querySelector<HTMLElement>('[data-column-index="0"]')!.dataset.drop).toBe('before');
    fire(handles[1], 'pointerup', 50, 20);
    expect(options.moveColumn).toHaveBeenCalledWith(1, 0);
  });

  it('opens a column’s menu on a hold of its header', () => {
    fire(handles[0], 'pointerdown', 50, 20);
    vi.advanceTimersByTime(600);
    expect(options.menu).toHaveBeenCalledWith({ kind: 'column', column: 0 }, { x: 50, y: 20 });
  });

  it('opens menus on a right click', () => {
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 260, clientY: 130 });
    cards[1][0].dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(options.menu).toHaveBeenCalledWith({ kind: 'card', ref: { column: 1, card: 0 } }, { x: 260, y: 130 });
  });

  it('leaves presses in fields alone', () => {
    fire(cards[0][0].querySelector('input')!, 'pointerdown', 50, 120);
    vi.advanceTimersByTime(1000);
    expect(play).not.toHaveBeenCalled();
    expect(options.menu).not.toHaveBeenCalled();
  });
});
