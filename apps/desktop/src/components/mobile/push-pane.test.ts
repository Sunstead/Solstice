// @vitest-environment jsdom
import { createElement as h, createRef } from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  window.matchMedia ??= ((query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

import { PushPane } from './push-pane';

// The settings dialog and the phone's You page push a page only once one is
// asked for, so the pane mounts already open; Back must still take it away.
describe('PushPane', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    // Motion off: settling lands at once.
    document.documentElement.dataset.reduceMotion = 'true';
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    delete document.documentElement.dataset.reduceMotion;
    vi.restoreAllMocks();
  });

  const render = (open: boolean, keepMounted = false) =>
    act(() => {
      root.render(h(PushPane, { open, onClose: () => {}, keepMounted, children: h('p', null, 'Appearance') }));
    });
  const page = () => [...container.querySelectorAll('p')].find((p) => p.textContent === 'Appearance');
  const pane = () => container.querySelector<HTMLElement>('.solstice-push') ?? undefined;

  it('goes back after being pushed onto a closed list', () => {
    render(false);
    expect(page()).toBeUndefined();
    render(true);
    expect(page()).toBeDefined();
    render(false);
    expect(page()).toBeUndefined();
  });

  it('goes back when it was open from the start', () => {
    render(true);
    render(false);
    expect(page()).toBeUndefined();
  });

  it('goes back again after a second push', () => {
    render(false);
    render(true);
    render(false);
    render(true);
    expect(page()).toBeDefined();
    render(false);
    expect(page()).toBeUndefined();
  });

  it('kept mounted, hides instead', () => {
    render(false, true);
    render(true, true);
    expect(pane()!.style.visibility).toBe('');
    render(false, true);
    expect(pane()!.style.visibility).toBe('hidden');
    expect(pane()!.style.transform).toBe('translateX(100%)');
  });

  it('slides in when pushed', () => {
    delete document.documentElement.dataset.reduceMotion;
    const animate = vi.fn(() => ({ finished: new Promise(() => {}), cancel: () => {} }) as unknown as Animation);
    Element.prototype.animate = animate;
    const behind = createRef<HTMLDivElement>();
    act(() => {
      root.render(h(PushPane, { open: false, onClose: () => {}, behind, children: h('p', null, 'Appearance') }));
    });
    act(() => {
      root.render(h(PushPane, { open: true, onClose: () => {}, behind, children: h('p', null, 'Appearance') }));
    });
    const width = window.innerWidth;
    expect(animate).toHaveBeenCalledWith(
      [{ transform: `translateX(${width}px)` }, { transform: 'translateX(0px)' }],
      expect.anything(),
    );
  });

  // The pane is a scroll view resting on the page; reaching its left is the
  // swipe back, so the owner is told once, and the page leaves with no slide.
  it('goes back when scrolled all the way to the left', () => {
    const onClose = vi.fn();
    act(() => {
      root.render(h(PushPane, { open: true, onClose, keepMounted: true, children: h('p', null, 'Appearance') }));
    });
    const el = pane()!;
    Object.defineProperty(el, 'clientWidth', { value: 400, configurable: true });
    el.scrollLeft = 200;
    act(() => {
      el.dispatchEvent(new Event('scroll'));
    });
    expect(onClose).not.toHaveBeenCalled();
    el.scrollLeft = 0;
    act(() => {
      el.dispatchEvent(new Event('scroll'));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(el.style.visibility).toBe('hidden');
  });
});
