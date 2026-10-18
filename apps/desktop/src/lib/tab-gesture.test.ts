// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Model } from 'flexlayout-react';

const play = vi.hoisted(() => vi.fn());
vi.mock('@/lib/haptics', () => ({ haptics: { play, prepare: vi.fn() } }));

import { createTabGesture } from './tab-gesture';

const WIDTH = 100;

// A strip of three tabs, 100px apiece, from x=0, in a layout of one tabset.
describe('createTabGesture', () => {
  let model: Model;
  let strip: HTMLDivElement;
  let buttons: HTMLElement[];
  let open: ReturnType<typeof vi.fn>;
  let gesture: ReturnType<typeof createTabGesture>;

  const order = () =>
    (model.getNodeById('a')!.getParent()!.getChildren() as { getId(): string }[]).map((c) => c.getId());

  const pointer = (type: string, target: Element, x: number, y = 10) =>
    target.dispatchEvent(
      new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 1, pointerType: 'touch', clientX: x, clientY: y }),
    );

  beforeEach(() => {
    vi.useFakeTimers();
    play.mockClear();
    model = Model.fromJson({
      global: {},
      layout: {
        type: 'row',
        children: [
          {
            type: 'tabset',
            children: ['a', 'b', 'c'].map((id) => ({ type: 'tab', id, name: id, component: 'editor' })),
          },
        ],
      },
    });
    strip = document.createElement('div');
    buttons = ['a', 'b', 'c'].map((id, i) => {
      const button = document.createElement('div');
      button.className = 'flexlayout__tab_button';
      button.innerHTML = `<span data-tab-id="${id}">${id}</span>`;
      button.getBoundingClientRect = () => new DOMRect(i * WIDTH, 0, WIDTH, 30);
      strip.append(button);
      return button;
    });
    document.body.append(strip);
    open = vi.fn();
    gesture = createTabGesture({ model: () => model, open });
  });

  afterEach(() => {
    gesture.dispose();
    strip.remove();
    document.querySelectorAll('.solstice-tab-ghost').forEach((g) => g.remove());
    vi.useRealTimers();
  });

  const ghost = () => document.querySelector('.solstice-tab-ghost');

  it('lifts a held tab, and opens its menu below it if the finger stays still', () => {
    pointer('pointerdown', buttons[1], 150);
    vi.advanceTimersByTime(299);
    expect(ghost()).toBeNull();
    vi.advanceTimersByTime(1);
    expect(ghost()).not.toBeNull();
    expect(play).toHaveBeenCalledWith('lift');
    expect(buttons[1].style.opacity).toBe('0');
    expect(open).not.toHaveBeenCalled();

    vi.advanceTimersByTime(250);
    expect(open).toHaveBeenCalledWith({ tabId: 'b', x: 100, y: 36 });
  });

  it('drags instead of opening the menu when the finger moves after the lift', () => {
    pointer('pointerdown', buttons[0], 50);
    vi.advanceTimersByTime(300);
    pointer('pointermove', buttons[0], 120);
    vi.advanceTimersByTime(1000);
    expect(open).not.toHaveBeenCalled();
  });

  it('reorders by dropping a dragged tab past its neighbour', async () => {
    pointer('pointerdown', buttons[0], 50);
    vi.advanceTimersByTime(300);
    pointer('pointermove', buttons[0], 160);
    expect(play).toHaveBeenCalledWith('tick');
    pointer('pointerup', buttons[0], 160);
    await vi.advanceTimersByTimeAsync(300);

    expect(order()).toEqual(['b', 'a', 'c']);
    expect(ghost()).toBeNull();
    expect(buttons[0].style.opacity).toBe('');
    expect(play).toHaveBeenCalledWith('drop');
  });

  it('changes nothing when dropped back where it was', async () => {
    pointer('pointerdown', buttons[1], 150);
    vi.advanceTimersByTime(300);
    pointer('pointermove', buttons[1], 175);
    pointer('pointerup', buttons[1], 175);
    await vi.advanceTimersByTimeAsync(300);
    expect(order()).toEqual(['a', 'b', 'c']);
    expect(ghost()).toBeNull();
  });

  it('leaves a press that pans the strip to the strip', () => {
    pointer('pointerdown', buttons[1], 150);
    pointer('pointermove', buttons[1], 175);
    vi.advanceTimersByTime(1000);
    expect(ghost()).toBeNull();
    expect(open).not.toHaveBeenCalled();
  });

  it('opens the menu on release if the finger lifts after the tab does', () => {
    pointer('pointerdown', buttons[2], 250);
    vi.advanceTimersByTime(400);
    pointer('pointerup', buttons[2], 250);
    expect(open).toHaveBeenCalledWith({ tabId: 'c', x: 200, y: 36 });
  });

  it('sets the tab down when its menu closes', async () => {
    pointer('pointerdown', buttons[2], 250);
    vi.advanceTimersByTime(600);
    expect(open).toHaveBeenCalled();
    gesture.menuClosed();
    await vi.advanceTimersByTimeAsync(300);
    expect(ghost()).toBeNull();
    expect(buttons[2].style.opacity).toBe('');
  });

  it('keeps the click that follows a lift from selecting the tab', () => {
    pointer('pointerdown', buttons[2], 250);
    vi.advanceTimersByTime(600);
    pointer('pointerup', buttons[2], 250);
    const click = vi.fn();
    buttons[2].addEventListener('click', click);
    buttons[2].dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(click).not.toHaveBeenCalled();
  });

  it('ignores a mouse', () => {
    buttons[1].dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true, pointerType: 'mouse', pointerId: 1, clientX: 150 }),
    );
    vi.advanceTimersByTime(1000);
    expect(ghost()).toBeNull();
  });
});
