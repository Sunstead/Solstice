// @vitest-environment jsdom
import { act, createElement as h } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Model } from 'flexlayout-react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  // A touch screen: no fine pointer, so `touchFirst` and menus are sheets.
  window.matchMedia ??= ((query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

import { TabMenu } from './tab-menu';
import { useLayout } from '@/hooks/use-layout';

// On an iPad a tab's hold opens the same bottom sheet as everything else,
// not a dropdown at the finger.
describe('TabMenu on a touch screen', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    useLayout.setState({
      model: Model.fromJson({
        global: {},
        layout: {
          type: 'row',
          children: [{ type: 'tabset', children: [{ type: 'tab', id: 't', name: 'Groceries', component: 'editor' }] }],
        },
      }),
    });
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('opens a sheet headed by the tab, with its actions as rows', async () => {
    await act(async () => {
      root.render(h(TabMenu, { request: { tabId: 't', x: 10, y: 10, held: true }, onClose: () => {} }));
    });
    expect(document.querySelector("[data-slot='sheet-content']")).not.toBeNull();
    expect(document.querySelector('[role="menu"]')).toBeNull();
    const text = document.body.textContent ?? '';
    expect(text).toContain('Groceries');
    expect(text).toContain('New Tab to the Right');
    expect(text).toContain('Close Tab');
  });
});
