// @vitest-environment jsdom
import { act, createElement as h } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  window.matchMedia ??= ((query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
vi.mock('@/lib/backend/platform', () => ({ touchFirst: true }));

import { SidebarProvider } from '@sunstead/ui/components/resizable-sidebar';
import { railStyle } from './sidebar-rail';

// Where a finger leads (the iPad), the icon rail is as wide as Discord's
// server list, so its buttons are easy to hit. The title bar and the
// collapsed sidebar follow the same variable.
describe('the icon rail', () => {
  it('is wider where touch leads', () => {
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    act(() => root.render(h(SidebarProvider, { style: railStyle }, null)));
    const wrapper = container.querySelector<HTMLElement>('[data-slot="sidebar-wrapper"]')!;
    expect(wrapper.style.getPropertyValue('--sidebar-width-icon')).toBe('4.5rem');
    act(() => root.unmount());
  });
});
