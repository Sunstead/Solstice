// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { reconsiderDock, watchStickyDock } from '@/lib/tab-dock';

const RECT = { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, height: 40, toJSON() {} };

/**
 * A tab strip as flexlayout renders it; `docked` leaves the + out of it, in the
 * toolbar. jsdom has no layout: tabs are 12rem (192px) with 1px of margin, the
 * + 42px with its padding, the strip \`width\` wide.
 */
function strip({ docked, tabs = 2, width = 500 }: { docked: boolean; tabs?: number; width?: number }) {
  const bar = document.createElement('div');
  bar.className = 'flexlayout__tabset_tabbar_outer';
  const inner = document.createElement('div');
  inner.className = 'flexlayout__tabset_tabbar_inner';
  Object.defineProperty(inner, 'clientWidth', { value: width, configurable: true });
  bar.append(inner);
  const container = document.createElement('div');
  container.className = 'flexlayout__tabset_tabbar_inner_tab_container';
  for (let i = 0; i < tabs; i++) {
    const tab = document.createElement('div');
    tab.className = 'flexlayout__tab_button';
    tab.style.flexBasis = '192px';
    tab.style.margin = '0 1px';
    container.append(tab);
  }
  inner.append(container);
  if (docked) {
    const toolbar = document.createElement('div');
    toolbar.className = 'flexlayout__tab_toolbar';
    const plus = document.createElement('button');
    plus.getBoundingClientRect = () => ({ ...RECT, width: 40 }) as DOMRect;
    toolbar.append(plus);
    bar.append(toolbar);
  } else {
    const sticky = document.createElement('div');
    sticky.className = 'flexlayout__tab_toolbar_sticky_buttons_container';
    inner.append(sticky);
  }
  document.body.append(bar);
  return { inner, container, tab: (i: number) => container.children[i] as HTMLElement };
}

let frames: (() => void)[];
const frame = (f: () => void) => void frames.push(f);
const nextFrame = () => frames.splice(0).forEach((f) => f());
/** A frame the observers see, and the one that restores. */
const twoFrames = () => {
  nextFrame();
  nextFrame();
};
const settled = () => new Promise<void>((r) => setTimeout(r, 0));

beforeEach(() => {
  frames = [];
});
afterEach(() => document.body.replaceChildren());

// flexlayout docks the + at the bar's end when the tabs and it overrun the
// strip, and its check to undock adds 10px of slack the tabs, squeezed to fill
// the strip, never leave. It only checks when the strip resizes or another tab
// is selected, so a tab closing left the + at the end of a bar with room.
// Nudging the check is all that can be done from outside.
describe('reconsiderDock', () => {
  it('leaves a strip with its + beside the tabs alone', () => {
    const { inner, container } = strip({ docked: false });
    reconsiderDock(inner, frame);
    expect(container.style.maxWidth).toBe('');
    expect(inner.style.paddingRight).toBe('');
    expect(frames).toHaveLength(0);
  });

  it('gives the tabs room to spare, and the strip a size change, for a frame', () => {
    const { inner, container } = strip({ docked: true });
    reconsiderDock(inner, frame);
    expect(container.style.maxWidth).toBe('calc(100% - 12px)');
    expect(inner.style.paddingRight).toBe('1px');
    // Still so after the frame whose layout the observers see.
    nextFrame();
    expect(container.style.maxWidth).toBe('calc(100% - 12px)');
    nextFrame();
    expect(container.style.maxWidth).toBe('');
    expect(inner.style.paddingRight).toBe('');
  });

  it('leaves tabs that still overrun the strip beside the + docked', () => {
    // 3 x 194px, the 42px + and 10px of slack: 634px of 500 (flexlayout would
    // dock it again at once, with the room still there to undock it again).
    const { inner, container } = strip({ docked: true, tabs: 3 });
    reconsiderDock(inner, frame);
    expect(container.style.maxWidth).toBe('');
    expect(frames).toHaveLength(0);
  });

  it('counts the room its + takes, and the slack', () => {
    // 2 x 194 + 42 + 10 = 440.
    const fits = strip({ docked: true, width: 440 });
    reconsiderDock(fits.inner, frame);
    expect(fits.container.style.maxWidth).toBe('calc(100% - 12px)');
    twoFrames();
    const short = strip({ docked: true, width: 439 });
    reconsiderDock(short.inner, frame);
    expect(short.container.style.maxWidth).toBe('');
  });

  it('counts a held tab as wide as it is, not as wide as it would be', () => {
    const { inner, container, tab } = strip({ docked: true, tabs: 3 });
    for (const i of [0, 1, 2]) {
      tab(i).dataset.tabFrozen = '';
      tab(i).getBoundingClientRect = () => ({ ...RECT, width: 100 }) as DOMRect;
    }
    reconsiderDock(inner, frame);
    expect(container.style.maxWidth).toBe('calc(100% - 12px)');
  });

  it('keeps what the strip had set', () => {
    const { inner, container } = strip({ docked: true });
    container.style.maxWidth = '50%';
    inner.style.paddingRight = '3px';
    reconsiderDock(inner, frame);
    twoFrames();
    expect(container.style.maxWidth).toBe('50%');
    expect(inner.style.paddingRight).toBe('3px');
  });

  it('is not stacked by a second call within the frame', () => {
    const { inner, container } = strip({ docked: true });
    container.style.maxWidth = '50%';
    reconsiderDock(inner, frame);
    reconsiderDock(inner, frame);
    twoFrames();
    expect(container.style.maxWidth).toBe('50%');
  });
});

describe('watchStickyDock', () => {
  let dispose: () => void;
  afterEach(() => dispose?.());

  it('reconsiders a docked strip when a tab leaves it', async () => {
    const { inner, container, tab } = strip({ docked: true });
    dispose = watchStickyDock(document.body, frame);
    tab(1).remove();
    await settled();
    expect(container.style.maxWidth).toBe('calc(100% - 12px)');
    expect(inner.style.paddingRight).toBe('1px');
  });

  it('looks again once the strip has settled, as it grows when its hidden-tabs button goes', async () => {
    vi.useFakeTimers();
    try {
      const { inner, container, tab } = strip({ docked: true, tabs: 3, width: 400 });
      dispose = watchStickyDock(document.body, frame);
      tab(1).remove();
      await vi.advanceTimersByTimeAsync(0);
      expect(container.style.maxWidth).toBe('');
      Object.defineProperty(inner, 'clientWidth', { value: 500, configurable: true });
      await vi.advanceTimersByTimeAsync(200);
      expect(container.style.maxWidth).toBe('calc(100% - 12px)');
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not for a strip with its + beside the tabs', async () => {
    const { container, tab } = strip({ docked: false });
    dispose = watchStickyDock(document.body, frame);
    tab(1).remove();
    await settled();
    expect(container.style.maxWidth).toBe('');
  });

  it('does not when a tab arrives', async () => {
    const { container } = strip({ docked: true });
    dispose = watchStickyDock(document.body, frame);
    const tab = document.createElement('div');
    tab.className = 'flexlayout__tab_button';
    container.append(tab);
    await settled();
    expect(container.style.maxWidth).toBe('');
  });

  it('ignores whatever else leaves the page', async () => {
    const { container } = strip({ docked: true });
    const editor = document.createElement('p');
    editor.append(document.createElement('span'));
    document.body.append(editor);
    dispose = watchStickyDock(document.body, frame);
    editor.firstElementChild!.remove();
    await settled();
    expect(container.style.maxWidth).toBe('');
  });

  it('stops when disposed', async () => {
    const { container, tab } = strip({ docked: true });
    dispose = watchStickyDock(document.body, frame);
    dispose();
    tab(0).remove();
    await settled();
    expect(container.style.maxWidth).toBe('');
  });
});
