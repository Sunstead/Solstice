// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Model, TabSetNode } from 'flexlayout-react';
import { closeTab, isClosing, markEntering, playEnter } from '@/lib/tab-motion';

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
