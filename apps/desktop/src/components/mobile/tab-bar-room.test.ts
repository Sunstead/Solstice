// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import path from 'node:path';
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

// A phone, and a tree far longer than any screen.
vi.mock('@sunstead/ui/hooks/use-mobile', () => ({ useIsMobile: () => true }));
vi.mock('@/components/file-tree', () => ({
  FileTree: () =>
    h(
      'ul',
      null,
      Array.from({ length: 60 }, (_, i) => h('li', { key: i, 'data-row': i }, `Note ${i}`)),
    ),
}));
vi.mock('@/components/file-tree-context-menu-content', () => ({ FileTreeItemContextMenuContent: () => null }));
vi.mock('@/hooks/use-file-tree-dnd', () => ({
  useFileTreeDrop: () => ({ drop: () => {}, isOver: false, canDrop: false }),
}));
vi.mock('@/hooks/use-create-actions', () => ({ useCreateActions: () => [] }));
vi.mock('@/hooks/use-workspace', () => ({ useWorkspace: () => null }));

import { ExplorerTree } from '@/components/explorer-sidebar';

/** A class that fixes an element's height, so what's in it can run past it. */
const PINNED = /(^|\s)(h-full|h-screen|h-dvh|h-\d|h-\[|max-h-)/;

/**
 * The iPhone's tab bar floats over the Files page, so the tree ends with room
 * for it (`TabBarRoom`). That room has to follow the last row in the flow the
 * rows are laid out in: it once came after the tree's group, which is pinned
 * to the view's height, so a long tree ran past it and its last rows stayed
 * under the bar.
 */
describe('room for the tab bar under the file tree', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    act(() => root.render(h(ExplorerTree, { path: '/workspace' })));
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const rows = () => [...container.querySelectorAll<HTMLElement>('[data-row]')];
  const room = () => container.querySelector<HTMLElement>('[data-tab-bar-room]');

  it('is in the scrolling list, once', () => {
    const scroller = container.querySelector('[data-slot="sidebar-content"]');
    expect(container.querySelectorAll('[data-tab-bar-room]')).toHaveLength(1);
    expect(scroller?.contains(room())).toBe(true);
  });

  it('comes after the last row', () => {
    const all = rows();
    const last = all[all.length - 1];
    expect(last.compareDocumentPosition(room()!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('shares the rows’ flow: nothing between them and it is pinned to a height', () => {
    const spacer = room()!;
    const all = rows();
    const last = all[all.length - 1];
    const shared = spacer.parentElement!;
    expect(shared.contains(last)).toBe(true);
    // From the last row up to the element the room sits in, every holder
    // grows with what's in it; the room's own parent may be pinned, since the
    // rows and the room overflow it together.
    for (let el = last.parentElement; el && el !== shared; el = el.parentElement) {
      expect(el.className, `${el.tagName} holds the rows`).not.toMatch(PINNED);
    }
  });
});

describe('the room’s size', () => {
  const css = readFileSync(path.resolve(__dirname, '../../styles/app.css'), 'utf8');

  it('is nothing without the native tab bar', () => {
    expect(css).toMatch(/\.tab-bar-room\s*\{[^}]*display:\s*none/);
  });

  it('is the bar’s height and a margin with it', () => {
    const rule = css.match(/:root\[data-native-tab-bar\]\s+\.tab-bar-room\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(rule).toMatch(/display:\s*block/);
    expect(rule).toMatch(/height:\s*calc\(var\(--tab-bar-inset[^)]*\)\s*\+\s*[\d.]+rem\)/);
  });
});
