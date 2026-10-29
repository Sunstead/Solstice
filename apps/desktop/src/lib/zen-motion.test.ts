import { describe, expect, it } from 'vitest';
import { bandPieces, paneOffset } from '@/lib/zen-motion';

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
