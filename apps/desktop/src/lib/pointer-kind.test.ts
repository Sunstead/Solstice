// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { trackPointerKind } from './pointer-kind';

describe('data-pointer', () => {
  let stop: () => void;
  beforeEach(() => {
    stop = trackPointerKind();
  });
  afterEach(() => {
    stop();
    delete document.documentElement.dataset.pointer;
  });

  const kind = () => document.documentElement.dataset.pointer;
  const send = (type: string, pointerType: string) =>
    document.body.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerType }));

  it.each([
    ['touch', 'touch'],
    ['pen', 'pen'],
    ['mouse', 'mouse'],
    ['', 'mouse'],
  ])('names a %s pointer %s', (pointerType, expected) => {
    send('pointerdown', pointerType);
    expect(kind()).toBe(expected);
  });

  // A finger's tap turns hover off; the Pencil hovering turns it back on.
  it('flips back to the Pencil when it hovers after a tap', () => {
    send('pointerdown', 'touch');
    send('pointerover', 'pen');
    expect(kind()).toBe('pen');
    send('pointerdown', 'touch');
    send('pointermove', 'pen');
    expect(kind()).toBe('pen');
  });

  it('stops listening when disposed', () => {
    send('pointerdown', 'mouse');
    stop();
    send('pointerdown', 'touch');
    expect(kind()).toBe('mouse');
  });
});
