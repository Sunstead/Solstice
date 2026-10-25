import { describe, expect, it } from 'vitest';
import { paneOffset } from '@/lib/zen-motion';

const rect = (left: number, top: number) => ({ left, top });

describe('paneOffset', () => {
  it('puts the pane back where it was: right and down entering, up and left leaving', () => {
    expect(paneOffset(rect(310, 88), rect(0, 44))).toEqual({ x: 310, y: 44 });
    expect(paneOffset(rect(0, 44), rect(64, 88))).toEqual({ x: -64, y: -44 });
  });
});
