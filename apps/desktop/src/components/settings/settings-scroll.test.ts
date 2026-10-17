// @vitest-environment jsdom
import { createElement as h, act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(async () => {
  (globalThis as { React?: unknown }).React = await import('react');
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

import { SettingsScroll } from './settings-scroll';

describe('SettingsScroll', () => {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  afterEach(() => act(() => root.render(null)));

  const viewport = () => container.querySelector('[data-slot="scroll-area-viewport"]');
  const show = (page: string) => act(() => root.render(h(SettingsScroll, { page, children: 'body' })));

  it('starts a new page on a fresh viewport, so scroll and scrollbar reset', () => {
    show('appearance');
    const first = viewport();
    expect(first).not.toBeNull();
    show('appearance');
    expect(viewport()).toBe(first);
    show('editor');
    expect(viewport()).not.toBe(first);
  });
});
