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

// A press on the title bar while a dialog covers it drags the window, and
// leaves the dialog open: the press never reaches the dialog's outside-press
// handling.
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
    document.addEventListener('click', reached);
  });

  afterEach(() => {
    stop();
    document.removeEventListener('mousedown', reached);
    document.removeEventListener('click', reached);
    vi.clearAllMocks();
  });

  const under = (beneath: Element) => {
    document.elementsFromPoint = () => [overlay, beneath, document.body];
  };
  const press = (detail = 1) => {
    overlay.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, detail }));
    overlay.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0, detail }));
  };

  it('drags the window from a title bar under the overlay', () => {
    under(header);
    press();
    expect(startDragging).toHaveBeenCalledOnce();
    expect(reached).not.toHaveBeenCalled();
  });

  it('maximizes on a double-click', () => {
    under(header);
    press(2);
    expect(toggleMaximize).toHaveBeenCalledOnce();
    expect(startDragging).not.toHaveBeenCalled();
  });

  it('leaves a press over anything else to the dialog', () => {
    under(header.nextElementSibling!);
    press();
    expect(startDragging).not.toHaveBeenCalled();
    expect(reached).toHaveBeenCalledTimes(2);
  });

  it('lets the next ordinary click through', () => {
    under(header);
    press();
    under(header.nextElementSibling!);
    press();
    expect(reached).toHaveBeenCalledTimes(2);
  });
});
