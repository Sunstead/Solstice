// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createElement as h } from 'react';
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

import { Sidebar, SidebarProvider, SidebarRail } from '@sunstead/ui/components/resizable-sidebar';

// The rail is what resizes the sidebar. A finger or the Pencil drags it only
// if it listens for pointer events: iOS sends no mousemove for a touch drag.
describe('sidebar rail', () => {
  let container: HTMLDivElement;
  let root: Root;
  let onOpenChange: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    onOpenChange = vi.fn();
    act(() => {
      root.render(
        h(
          SidebarProvider,
          { defaultWidth: '256px', open: true, onOpenChange },
          h(Sidebar, { collapsible: 'rail' }, h(SidebarRail)),
        ),
      );
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const rail = () => container.querySelector<HTMLElement>('[data-slot="sidebar-rail"]')!;
  const width = () =>
    container.querySelector<HTMLElement>('[data-slot="sidebar-wrapper"]')!.style.getPropertyValue('--sidebar-width');
  const pointer = (target: EventTarget, type: string, pointerType: string, clientX: number) =>
    act(() => {
      target.dispatchEvent(new PointerEvent(type, { bubbles: true, button: 0, pointerId: 1, pointerType, clientX }));
    });

  it.each(['touch', 'pen'])('drags with %s', (kind) => {
    pointer(rail(), 'pointerdown', kind, 256);
    pointer(document, 'pointermove', kind, 300);
    pointer(document, 'pointermove', kind, 320);
    pointer(document, 'pointerup', kind, 320);
    expect(width()).not.toBe('256px');
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it.each(['touch', 'pen'])('ignores a %s tap', (kind) => {
    pointer(rail(), 'pointerdown', kind, 256);
    pointer(document, 'pointerup', kind, 256);
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it('toggles on a mouse click', () => {
    pointer(rail(), 'pointerdown', 'mouse', 256);
    pointer(document, 'pointerup', 'mouse', 256);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});

// The rail hangs half outside the sidebar's container, centred on its edge.
// `overflow-hidden` there clips that half, and a clipped half takes no touch.
describe("AppSidebar's container", () => {
  it('leaves the rail unclipped', () => {
    const source = readFileSync(path.resolve(__dirname, 'app-sidebar.tsx'), 'utf8');
    const rail = source.match(/collapsible='rail'[\s\S]*?className=\{cn\(([\s\S]*?)\)\}/);
    expect(rail).not.toBeNull();
    const classes = [...rail![1].matchAll(/'([^']*)'/g)].flatMap((m) => m[1].split(/\s+/));
    expect(classes).toContain('*:data-[sidebar=sidebar]:overflow-hidden');
    expect(classes.filter((name) => name === 'overflow-hidden')).toEqual([]);
  });
});
