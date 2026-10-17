// @vitest-environment jsdom
import { act, createElement as h } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

import { useTabLongPress, type TabMenuRequest } from './tab-long-press';

// iOS lifts a held tab for a drag with a mousedown of its own, then
// `dragstart`. Once the menu is open, that mousedown mustn't reach the menu,
// which would take it for a press outside and close; nor be cancelled, which
// would stop the drag.
describe('useTabLongPress', () => {
  let container: HTMLDivElement;
  let root: Root;
  let tab: HTMLElement;
  let open: ReturnType<typeof vi.fn<(request: TabMenuRequest) => void>>;

  beforeEach(() => {
    vi.useFakeTimers();
    container = document.createElement('div');
    container.innerHTML =
      '<div class="flexlayout__tab_button"><span data-tab-id="t1">Tab</span></div>';
    document.body.append(container);
    tab = container.querySelector('span')!;
    open = vi.fn();
    const close = () => {};
    function Probe() {
      useTabLongPress(open, close);
      return null;
    }
    root = createRoot(document.createElement('div'));
    act(() => root.render(h(Probe)));
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  const hold = () => {
    tab.dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch', clientX: 10, clientY: 10 }),
    );
    vi.advanceTimersByTime(500);
  };

  it('opens the menu on a hold', () => {
    hold();
    expect(open).toHaveBeenCalledWith({ tabId: 't1', x: 10, y: 10, held: true });
  });

  it("keeps the lift's mousedown from the menu, without stopping the drag", () => {
    hold();
    const menu = vi.fn();
    document.addEventListener('mousedown', menu, true);
    const lift = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    tab.dispatchEvent(lift);
    document.removeEventListener('mousedown', menu, true);
    expect(menu).not.toHaveBeenCalled();
    expect(lift.defaultPrevented).toBe(false);
  });
});
