// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { bandPieces, paneOffset, paneOrigin, playZen, zenMarks } from '@/lib/zen-motion';
import { fakeMotion } from '@/lib/test/fake-motion';

const rect = (left: number, top: number) => ({ left, top });

describe('paneOffset', () => {
  it('puts the pane back where it was: right and down entering, up and left leaving', () => {
    expect(paneOffset(rect(310, 88), rect(0, 44))).toEqual({ x: 310, y: 44 });
    expect(paneOffset(rect(0, 44), rect(64, 88))).toEqual({ x: -64, y: -44 });
  });
});

describe('bandPieces', () => {
  const pane = (left: number, top: number, width: number, height: number, native?: { left: number; top: number }) => ({
    left,
    top,
    width,
    height,
    native,
  });

  it('entering, paints the strip above the pane and left of it, corner included', () => {
    expect(bandPieces([pane(0, 0, 800, 1000)], { x: 300, y: 40 })).toEqual([
      { left: -300, top: -40, width: 300, height: 1040 },
      { left: 0, top: -40, width: 800, height: 40 },
    ]);
  });

  it('leaving, paints right of and below a note’s pane', () => {
    expect(bandPieces([pane(0, 0, 500, 900)], { x: -300, y: -40 })).toEqual([
      { left: 500, top: 0, width: 300, height: 940 },
      { left: 0, top: 900, width: 500, height: 40 },
    ]);
  });

  it('leaves what a native view covers to it: only its header’s rows', () => {
    expect(bandPieces([pane(0, 0, 500, 900, { left: 0, top: 100 })], { x: -300, y: -40 })).toEqual([
      { left: 500, top: 0, width: 300, height: 100 },
    ]);
  });

  it('paints beside the outermost panes only', () => {
    const left = pane(0, 0, 400, 900);
    const right = pane(410, 0, 400, 900, { left: 410, top: 100 });
    expect(bandPieces([left, right], { x: -300, y: -40 })).toEqual([
      { left: 0, top: 900, width: 400, height: 40 },
      { left: 810, top: 0, width: 300, height: 100 },
    ]);
  });
});

describe('playZen', () => {
  let motion: ReturnType<typeof fakeMotion>;
  let inset: HTMLElement;
  let column: HTMLElement;
  let mark: HTMLElement;
  /** Where layout puts the editor area; a running inset animation adds its first frame. */
  let at = { left: 300, top: 40, width: 700 };

  const shift = (el: Element) => {
    const t = motion.live(el)[0]?.keyframes[0]?.transform as string | undefined;
    const m = t?.match(/translate\((-?[\d.]+)px, (-?[\d.]+)px\)/);
    return m ? { x: +m[1], y: +m[2] } : { x: 0, y: 0 };
  };
  const rect = (left: number, top: number, width: number, height: number) =>
    ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top }) as DOMRect;

  beforeEach(() => {
    motion = fakeMotion();
    at = { left: 300, top: 40, width: 700 };
    inset = document.createElement('div');
    inset.style.padding = '0px';
    inset.getBoundingClientRect = () => {
      const s = shift(inset);
      return rect(at.left + s.x, at.top + s.y, at.width, 600);
    };
    const tab = document.createElement('div');
    tab.className = 'flexlayout__tab';
    tab.getBoundingClientRect = () => inset.getBoundingClientRect();
    mark = document.createElement('div');
    // Kept by its right edge, so it moves within the pane as that widens.
    mark.dataset.zenFlip = 'end';
    mark.getBoundingClientRect = () => {
      const r = inset.getBoundingClientRect();
      return rect(r.right - 60, r.top + 5, 50, 20);
    };
    tab.append(mark);
    inset.append(tab);
    column = document.createElement('div');
    document.body.append(column, inset);
  });
  afterEach(() => {
    motion.restore();
    document.body.replaceChildren();
  });

  it('hands back a cancel that stops its animations, frames, band and header copies', async () => {
    const before = paneOrigin(inset);
    const marks = zenMarks(inset);
    at = { left: 0, top: 0, width: 1000 };
    const run = playZen({ inset, column, entering: true, before, marks });
    expect(motion.live(inset)).toHaveLength(1);
    expect(motion.live(column)).toHaveLength(1);
    expect(inset.children.length).toBe(3);
    expect(mark.style.visibility).toBe('hidden');

    run.cancel();
    expect(motion.animations.every((a) => a.state === 'idle')).toBe(true);
    expect(inset.children.length).toBe(1);
    expect(mark.style.visibility).toBe('');
    expect(motion.pendingFrames()).toBe(0);
    await run.finished;
  });

  it('eases the column from where it is', () => {
    const before = paneOrigin(inset);
    at = { left: 0, top: 0, width: 1000 };
    playZen({ inset, column, entering: true, before, columnFrom: '-120px 0px' });
    expect(motion.live(column)[0].keyframes).toEqual([{ translate: '-120px 0px' }, { translate: '-100% 0' }]);
  });

  it('reads a header part from its moving copy, where it is on screen', () => {
    const before = paneOrigin(inset);
    const marks = zenMarks(inset);
    at = { left: 0, top: 0, width: 1000 };
    playZen({ inset, column, entering: true, before, marks });
    const copy = inset.lastElementChild!.firstElementChild as HTMLElement;
    copy.getBoundingClientRect = () => rect(123, 45, 50, 20);
    expect(zenMarks(inset).get(mark)).toEqual({ x: 173, top: 45 });
  });
});
