// @vitest-environment jsdom
import { act, createElement as h } from 'react';
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

import { TabMenu } from './tab-menu';
import type { TabMenuRequest } from '@/lib/tab-long-press';

// Holding a tab lifts it for a drag and opens its menu, as iOS does. The
// drag only reaches the tab strip if nothing covers it: a modal menu's
// backdrop would take every drag event, and flexlayout would lose the drag.
describe('TabMenu', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const show = async (request: TabMenuRequest) => {
    await act(async () => {
      root.render(h(TabMenu, { request, onClose: () => {} }));
    });
  };
  // Base UI's full-screen backdrop (others it marks inert keep their role).
  const backdrop = () => document.querySelector("[data-base-ui-inert][role='presentation']");

  it('leaves the strip uncovered when a hold opened it', async () => {
    await show({ tabId: 't', x: 10, y: 10, held: true });
    expect(document.querySelector('[role="menu"]')).not.toBeNull();
    expect(backdrop()).toBeNull();
  });

  // A right click's menu is modal, as on macOS: a click outside only closes it.
  it('is modal from a right click', async () => {
    await show({ tabId: 't', x: 10, y: 10 });
    expect(document.querySelector('[role="menu"]')).not.toBeNull();
    expect(backdrop()).not.toBeNull();
  });
});
