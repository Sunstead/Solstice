// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dragRegionUnder, dragThroughOverlays, isDragRegion } from './window-drag';

const el = (html: string) => {
  const host = document.createElement('div');
  host.innerHTML = html;
  document.body.append(host);
  return host;
};

/** `el` and its ancestors, the way an event's composed path runs. */
const pathFrom = (start: Element) => {
  const path: Element[] = [];
  for (let at: Element | null = start; at; at = at.parentElement) path.push(at);
  return path;
};

afterEach(() => document.body.replaceChildren());

// The same rules as Tauri's drag.js, which only sees the press's own target.
describe('isDragRegion', () => {
  it('drags from a bare region pressed directly, not from its children', () => {
    const host = el('<header data-tauri-drag-region><span>Title</span></header>');
    const header = host.querySelector('header')!;
    expect(isDragRegion(pathFrom(header))).toBe(true);
    expect(isDragRegion(pathFrom(host.querySelector('span')!))).toBe(false);
  });

  it('drags from anywhere inside a deep region', () => {
    const host = el('<header data-tauri-drag-region="deep"><span>Title</span></header>');
    expect(isDragRegion(pathFrom(host.querySelector('span')!))).toBe(true);
  });

  it('never drags from a disabled region or a control', () => {
    const host = el(
      '<header data-tauri-drag-region="deep"><div data-tauri-drag-region="false"><i></i></div><button><b></b></button></header>',
    );
    expect(isDragRegion(pathFrom(host.querySelector('i')!))).toBe(false);
    expect(isDragRegion(pathFrom(host.querySelector('b')!))).toBe(false);
  });
});

describe('dragRegionUnder', () => {
  it('looks through overlays to what is beneath', () => {
    const host = el(
      '<header data-tauri-drag-region></header><div class="portal"><div data-base-ui-inert role="presentation"></div><div data-slot="dialog-overlay"></div></div>',
    );
    const header = host.querySelector('header')!;
    const [backdrop, overlay] = host.querySelectorAll('.portal > div');
    const portal = host.querySelector('.portal')!;
    // elementsFromPoint: topmost first, the overlay's own ancestors included.
    const stack = [overlay, backdrop, portal, header, host, document.body];
    expect(dragRegionUnder(stack, overlay)).toBe(true);
  });

  it('is false when a control lies beneath', () => {
    const host = el('<button data-x></button><div data-slot="dialog-overlay"></div>');
    const overlay = host.querySelector('[data-slot]')!;
    const stack = [overlay, host.querySelector('button')!, host, document.body];
    expect(dragRegionUnder(stack, overlay)).toBe(false);
  });
});

// A press on the title bar while a dialog covers it is two things. Dragged, it
// moves the window. Clicked, it is a click outside the dialog like any other.
//
// Starting the native drag on the press itself, as drag.js does, is what broke
// clicking it: the operating system's drag loop takes the mouse-up, and with
// no movement it ends at once having started nothing, but the page never hears
// the button come up. The press is then still "held" as far as the dialog and
// the webview know, and the clicks after it don't register.
describe('dragThroughOverlays', () => {
  const startDragging = vi.fn(async () => {});
  const toggleMaximize = vi.fn(async () => {});
  let stop: () => void;
  let header: Element;
  let overlay: HTMLElement;
  let reached: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    const host = el(
      '<header data-tauri-drag-region></header><p>Body</p><div data-slot="dialog-overlay"></div>',
    );
    header = host.querySelector('header')!;
    overlay = host.querySelector('[data-slot]') as HTMLElement;
    stop = dragThroughOverlays(() => ({ startDragging, toggleMaximize }));
    reached = vi.fn();
    document.addEventListener('mousedown', reached);
    document.addEventListener('mouseup', reached);
    document.addEventListener('click', reached);
  });

  afterEach(() => {
    stop();
    document.removeEventListener('mousedown', reached);
    document.removeEventListener('mouseup', reached);
    document.removeEventListener('click', reached);
    vi.clearAllMocks();
  });

  const under = (beneath: Element) => {
    document.elementsFromPoint = () => [overlay, beneath, document.body];
  };
  const mouse = (type: string, init: MouseEventInit = {}, target: EventTarget = overlay) => {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, buttons: 1, ...init });
    target.dispatchEvent(event);
    return event;
  };
  const down = (detail = 1) => mouse('mousedown', { detail });
  const move = (dx: number, dy = 0, init: MouseEventInit = {}) =>
    mouse('mousemove', { clientX: 100 + dx, clientY: 20 + dy, ...init });
  const up = () => mouse('mouseup', { buttons: 0 });
  const click = () => mouse('click', { buttons: 0 });
  const pressAt = () => mouse('mousedown', { clientX: 100, clientY: 20 });

  it('does not start a drag on the press alone', () => {
    under(header);
    pressAt();
    expect(startDragging).not.toHaveBeenCalled();
  });

  it('leaves a click on the title bar to the dialog, as a click outside it', () => {
    under(header);
    pressAt();
    up();
    const clicked = click();
    expect(startDragging).not.toHaveBeenCalled();
    expect(toggleMaximize).not.toHaveBeenCalled();
    expect(clicked.defaultPrevented).toBe(false);
    expect(reached.mock.calls.map(([e]) => e.type)).toEqual(['mousedown', 'mouseup', 'click']);
  });

  it('forgives a hand that shakes while clicking', () => {
    under(header);
    pressAt();
    move(2, 1);
    up();
    click();
    expect(startDragging).not.toHaveBeenCalled();
    expect(reached).toHaveBeenCalledTimes(3);
  });

  it('drags the window once the press moves', () => {
    under(header);
    pressAt();
    move(12);
    move(30);
    expect(startDragging).toHaveBeenCalledOnce();
  });

  it('keeps the click that ends a drag from closing the dialog', () => {
    under(header);
    pressAt();
    move(12);
    up();
    const clicked = click();
    expect(clicked.defaultPrevented).toBe(true);
    expect(reached.mock.calls.map(([e]) => e.type)).not.toContain('click');
  });

  it('ignores movement with no button held', () => {
    under(header);
    pressAt();
    up();
    click();
    move(40, 0, { buttons: 0 });
    expect(startDragging).not.toHaveBeenCalled();
  });

  it('maximizes on a double-click', () => {
    under(header);
    down(2);
    expect(toggleMaximize).toHaveBeenCalledOnce();
    expect(startDragging).not.toHaveBeenCalled();
  });

  it('leaves a press over anything else to the dialog', () => {
    under(header.nextElementSibling!);
    pressAt();
    move(40);
    up();
    click();
    expect(startDragging).not.toHaveBeenCalled();
    expect(reached).toHaveBeenCalledTimes(3);
  });

  // The system's drag loop eats the mouse-up (and so the click), so nothing
  // here ever tells the page the button came up.
  describe('after the system has had the mouse', () => {
    const pointerups: Event[] = [];
    const record = (e: Event) => pointerups.push(e);

    beforeEach(() => {
      pointerups.length = 0;
      document.addEventListener('pointerup', record);
      document.addEventListener('mouseup', record);
    });
    afterEach(() => {
      document.removeEventListener('pointerup', record);
      document.removeEventListener('mouseup', record);
    });

    const drag = async () => {
      under(header);
      pressAt();
      move(12);
      await Promise.resolve();
      await Promise.resolve();
    };

    it('tells the page the button is up', async () => {
      await drag();
      expect(pointerups.map((e) => e.type).sort()).toEqual(['mouseup', 'pointerup']);
    });

    it('lets the next click through', async () => {
      await drag();
      reached.mockClear();
      under(header.nextElementSibling!);
      pressAt();
      up();
      const clicked = click();
      expect(clicked.defaultPrevented).toBe(false);
      expect(reached.mock.calls.map(([e]) => e.type)).toEqual(['mousedown', 'mouseup', 'click']);
    });

    it('lets a click through even if no press came first', async () => {
      await drag();
      reached.mockClear();
      const clicked = click();
      expect(clicked.defaultPrevented).toBe(false);
      expect(reached).toHaveBeenCalledTimes(1);
    });

    it('can drag again', async () => {
      await drag();
      await drag();
      expect(startDragging).toHaveBeenCalledTimes(2);
    });
  });
});
