// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const surfaces = vi.hoisted(() => ({
  beginSurfaceEase: vi.fn(),
  playSurfaceEase: vi.fn(),
  endSurfaceEase: vi.fn(),
}));
vi.mock('@/lib/native-surfaces', () => surfaces);

import { createZenController } from '@/lib/zen-controller';
import { fakeMotion, settle } from '@/lib/test/fake-motion';

describe('the Zen controller, toggled faster than it moves', () => {
  let motion: ReturnType<typeof fakeMotion>;
  let frame: HTMLElement;
  let inset: HTMLElement;
  let column: HTMLElement;
  /** Where layout puts the editor area: in Zen at the window's corner. */
  let zen = false;
  /** The column's computed `translate`, as a running animation leaves it. */
  let columnTranslate = 'none';
  let controller: ReturnType<typeof createZenController>;

  /** A held animation shows its first frame; a running one, halfway. */
  const shift = (el: Element) => {
    const a = motion.live(el)[0];
    const m = (a?.keyframes[0]?.transform as string | undefined)?.match(/translate\((-?[\d.]+)px, (-?[\d.]+)px\)/);
    const k = a?.state === 'running' ? 0.5 : 1;
    return m ? { x: +m[1] * k, y: +m[2] * k } : { x: 0, y: 0 };
  };
  const rect = (left: number, top: number, width: number, height: number) =>
    ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top }) as DOMRect;

  /** The store's switch, then React's commit. */
  const toggle = (to: boolean) => {
    controller.prepare(to);
    zen = to;
    controller.play(to);
  };
  const runs = (el: Element) => motion.animations.filter((a) => a.el === el);

  beforeEach(() => {
    motion = fakeMotion();
    zen = false;
    columnTranslate = 'none';
    frame = document.createElement('div');
    column = document.createElement('div');
    inset = document.createElement('div');
    inset.style.padding = '0px';
    inset.getBoundingClientRect = () => {
      const s = shift(inset);
      return zen ? rect(s.x, s.y, 1000, 800) : rect(300 + s.x, 40 + s.y, 700, 760);
    };
    const tab = document.createElement('div');
    tab.className = 'flexlayout__tab';
    tab.getBoundingClientRect = () => inset.getBoundingClientRect();
    inset.append(tab);
    frame.append(column, inset);
    document.body.append(frame);
    const real = window.getComputedStyle;
    vi.spyOn(window, 'getComputedStyle').mockImplementation((el, pseudo) =>
      el === column ? ({ translate: columnTranslate } as CSSStyleDeclaration) : real(el, pseudo),
    );
    controller = createZenController({ frame: { current: frame }, inset: { current: inset }, column: { current: column } });
    Object.values(surfaces).forEach((spy) => spy.mockClear());
  });
  afterEach(() => {
    motion.restore();
    vi.restoreAllMocks();
    document.body.replaceChildren();
  });

  it('cancels the first run’s animations and layers on a second toggle', () => {
    toggle(true);
    motion.frame(2);
    const first = [...motion.live(inset), ...motion.live(column)];
    expect(first).toHaveLength(2);
    expect(inset.children.length).toBe(2);

    toggle(false);
    expect(first.every((a) => a.state === 'idle')).toBe(true);
    // The tab, and the second run's band only.
    expect(inset.children.length).toBe(2);
  });

  it('measures the pane where it is on screen, before cancelling', () => {
    toggle(true);
    // Back at once, before anything moved: the pane is still where it was.
    toggle(false);
    expect(runs(inset)).toHaveLength(1);
  });

  it('ignores a stale run’s finish', async () => {
    toggle(true);
    motion.frame(2);
    const first = motion.animations.slice();
    toggle(false);
    motion.frame(2);
    first.forEach((a) => a.finish());
    await settle();
    expect(frame.hasAttribute('data-zen-moving')).toBe(true);
    expect(surfaces.endSurfaceEase).not.toHaveBeenCalled();
  });

  it('ends the native views’ ease once, for the latest run', async () => {
    toggle(true);
    motion.frame(2);
    toggle(false);
    motion.frame(2);
    toggle(true);
    motion.frame(2);
    expect(surfaces.endSurfaceEase).not.toHaveBeenCalled();
    motion.animations.forEach((a) => a.finish());
    await settle();
    expect(surfaces.endSurfaceEase).toHaveBeenCalledTimes(1);
    expect(frame.hasAttribute('data-zen-moving')).toBe(false);
    expect(column.style.visibility).toBe('hidden');
  });

  it('eases the column from its current translate', () => {
    toggle(true);
    motion.frame(2);
    columnTranslate = '-140px';
    toggle(false);
    const keyframes = motion.live(column)[0].keyframes;
    expect(keyframes[0]).toEqual({ translate: '-140px' });
    expect(keyframes[1]).toEqual({ translate: '0' });
  });

  it('never leaves the column hidden after entering then leaving', async () => {
    toggle(true);
    motion.frame(2);
    const first = motion.animations.slice();
    toggle(false);
    motion.frame(2);
    motion.animations.filter((a) => !first.includes(a)).forEach((a) => a.finish());
    await settle();
    first.forEach((a) => a.finish());
    await settle();
    expect(column.style.visibility).not.toBe('hidden');
    expect(frame.hasAttribute('data-zen-moving')).toBe(false);
  });
});
