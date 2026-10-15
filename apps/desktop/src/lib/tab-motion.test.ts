// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Model, TabSetNode } from 'flexlayout-react';
import { closeTab, isClosing, markEntering, playEnter, settle, watchClosePresses } from '@/lib/tab-motion';

function model(selected = 1) {
  return Model.fromJson({
    global: {},
    layout: {
      type: 'row',
      children: [
        {
          type: 'tabset',
          id: 'set',
          selected,
          children: ['a', 'b', 'c'].map((id) => ({ type: 'tab', id, name: id, component: 'blank' })),
        },
      ],
    },
  });
}

const ids = (m: Model) => (m.getNodeById('set') as TabSetNode).getChildren().map((c) => c.getId());
const selected = (m: Model) => (m.getNodeById('set') as TabSetNode).getSelectedNode()?.getId();

/** A tab button that records its animations and finishes them on demand. */
function button(id: string) {
  const el = document.createElement('div');
  el.id = `flexlayout-tabbutton-${id}`;
  el.className = 'flexlayout__tab_button';
  const finishes: (() => void)[] = [];
  el.animate = vi.fn(() => {
    let finish!: () => void;
    const finished = new Promise<void>((resolve) => (finish = resolve));
    finishes.push(finish);
    return { finished } as unknown as Animation;
  });
  document.body.append(el);
  return { el, finishAll: () => finishes.forEach((f) => f()) };
}

afterEach(() => {
  document.body.replaceChildren();
  delete document.documentElement.dataset.reduceMotion;
});

describe('closing a tab', () => {
  it('deletes at once when its button is not on screen', () => {
    const m = model();
    closeTab(m, 'b', { pointer: false });
    expect(ids(m)).toEqual(['a', 'c']);
  });

  it('hands the selection on now and leaves the model after the animation', async () => {
    const m = model();
    const { el, finishAll } = button('b');
    closeTab(m, 'b', { pointer: false });
    expect(selected(m)).toBe('c');
    expect(ids(m)).toEqual(['a', 'b', 'c']);
    expect(isClosing('b')).toBe(true);
    expect(el.style.pointerEvents).toBe('none');
    closeTab(m, 'b', { pointer: false });
    expect(el.animate).toHaveBeenCalledTimes(1);

    finishAll();
    await Promise.resolve();
    await Promise.resolve();
    expect(ids(m)).toEqual(['a', 'c']);
    expect(isClosing('b')).toBe(false);
  });

  it('selects the tab before when the last one closes', () => {
    const m = model(2);
    button('c');
    closeTab(m, 'c', { pointer: false });
    expect(selected(m)).toBe('b');
  });

  it('skips the motion when motion is reduced', () => {
    document.documentElement.dataset.reduceMotion = 'true';
    const m = model();
    const { el } = button('b');
    closeTab(m, 'b', { pointer: false });
    expect(el.animate).not.toHaveBeenCalled();
    expect(ids(m)).toEqual(['a', 'c']);
  });
});

describe('opening a tab', () => {
  it('only grows tabs marked as opened by the user', async () => {
    const marked = button('new');
    const restored = button('old');
    markEntering('new');
    playEnter('new', marked.el);
    playEnter('old', restored.el);
    await Promise.resolve();
    expect(marked.el.animate).toHaveBeenCalledTimes(1);
    expect(restored.el.animate).not.toHaveBeenCalled();

    // Each mark is used once: a later remount (a drag to another tabset) stays still.
    playEnter('new', marked.el);
    await Promise.resolve();
    expect(marked.el.animate).toHaveBeenCalledTimes(1);
  });
});

describe('a close from the pointer', () => {
  /** A close button in a tab strip, as flexlayout renders it. */
  function closeButton() {
    const strip = document.createElement('div');
    const close = document.createElement('div');
    close.className = 'flexlayout__tab_button_trailing';
    strip.append(close);
    document.body.append(strip);
    return { strip, close };
  }
  const press = (el: Element, pointerType: string) =>
    el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType }));

  it('holds widths when the mouse closed it', () => {
    const { strip, close } = closeButton();
    const presses = watchClosePresses(strip);
    press(close, 'mouse');
    expect(presses.pointer()).toBe(true);
    // Once per close: the keyboard's next close isn't the pointer's.
    expect(presses.pointer()).toBe(false);
    presses.dispose();
  });

  // A finger or the Pencil leaves the strip (pointerleave) before its tap's
  // click closes the tab, so a hold would never be let go.
  it.each(['touch', 'pen'])('resizes at once when %s closed it', (kind) => {
    const { strip, close } = closeButton();
    const presses = watchClosePresses(strip);
    press(close, kind);
    expect(presses.pointer()).toBe(false);
    presses.dispose();
  });

  it('ignores presses elsewhere in the strip', () => {
    const { strip } = closeButton();
    const presses = watchClosePresses(strip);
    press(strip, 'mouse');
    expect(presses.pointer()).toBe(false);
    presses.dispose();
  });
});

describe('holding widths', () => {
  /** A squeezed strip: tabs narrower than their max width. */
  function strip() {
    const outer = document.createElement('div');
    outer.className = 'flexlayout__tabset_tabbar_outer';
    const inner = document.createElement('div');
    outer.append(inner);
    document.body.append(outer);
    const tabs = ['a', 'b', 'c'].map((id) => {
      const { el } = button(id);
      el.style.maxWidth = '192px';
      el.style.margin = '0px';
      el.getBoundingClientRect = () => ({ width: 100 }) as DOMRect;
      inner.append(el);
      return el;
    });
    return { outer, tabs };
  }
  const held = (tabs: HTMLElement[]) => tabs.map((t) => t.style.getPropertyValue('--tab-held'));

  afterEach(() => settle());

  it('pins every tab when the pointer closes one', () => {
    const { tabs } = strip();
    closeTab(model(), 'b', { pointer: true });
    expect(held(tabs)).toEqual(['100px', '100px', '100px']);
    expect(tabs.every((t) => t.dataset.tabFrozen !== undefined)).toBe(true);
  });

  it('lets go when the pointer leaves the strip', () => {
    const { outer, tabs } = strip();
    closeTab(model(), 'b', { pointer: true });
    outer.dispatchEvent(new Event('pointerleave'));
    expect(held(tabs)).toEqual(['', '', '']);
  });

  it('lets go on a close that is not the pointer\'s', () => {
    const { tabs } = strip();
    const m = model();
    closeTab(m, 'b', { pointer: true });
    closeTab(m, 'c', { pointer: false });
    expect(held(tabs)).toEqual(['', '', '']);
  });

  it('holds nothing on a close that is not the pointer\'s', () => {
    const { tabs } = strip();
    closeTab(model(), 'b', { pointer: false });
    expect(held(tabs)).toEqual(['', '', '']);
  });
});
