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
  // jsdom has no Web Animations.
  Element.prototype.animate ??= function () {
    return { cancel: () => {}, finish: () => {}, onfinish: null } as unknown as Animation;
  };
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

vi.mock('@/lib/haptics', () => ({ haptics: { play: () => {} } }));

import { useInkUi } from '@/lib/stores/ink-tools';
import { SqueezePalette } from './squeeze-palette';

// The color and More Tools buttons fan their choices out on a band of their
// own; a second press puts the fan away and leaves the palette.
describe('SqueezePalette', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    useInkUi.setState({ palette: { x: 400, y: 300, page: 'tools' } });
    await act(async () => root.render(h(SqueezePalette)));
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    useInkUi.setState({ palette: null });
  });

  // Each band is a blurred, clipped layer.
  const bands = () => document.querySelectorAll('[style*="clip-path"]').length;
  const press = async (label: string) => {
    await act(async () => (document.querySelector(`[aria-label="${label}"]`) as HTMLButtonElement).click());
  };

  for (const label of ['Color', 'More Tools']) {
    it(`closes the whole fan when ${label} is pressed again`, async () => {
      expect(bands()).toBe(1);
      await press(label);
      expect(bands()).toBe(2);
      await press(label);
      expect(bands()).toBe(1);
      expect(useInkUi.getState().palette?.page).toBe('tools');
      // And opens again, once.
      await press(label);
      expect(bands()).toBe(2);
    });
  }
});
