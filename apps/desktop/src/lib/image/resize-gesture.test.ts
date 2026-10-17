import { describe, expect, it } from 'vitest';
import { resizeGesture } from './resize-gesture';

const start = { startX: 100, startWidth: 300, maxWidth: 600, direction: 1 as const };

describe('resizeGesture', () => {
  it('follows the pointer from either edge', () => {
    const right = resizeGesture(start);
    expect(right.move(150)).toBe(350);
    expect(right.end(false)).toBe(350);

    // The left handle grows the image as it moves left.
    const left = resizeGesture({ ...start, direction: -1 });
    expect(left.move(60)).toBe(340);
    expect(left.end(false)).toBe(340);
  });

  it('stays between the smallest grabbable width and the column', () => {
    const gesture = resizeGesture(start);
    expect(gesture.move(-1000)).toBe(48);
    expect(gesture.move(5000)).toBe(600);
  });

  // iOS cancels a touch it takes for a scroll or a drag. That's no resize, and
  // must not write the image's shown width into the note.
  it('commits nothing when cancelled', () => {
    expect(resizeGesture(start).end(true)).toBeNull();
    const moved = resizeGesture(start);
    moved.move(180);
    expect(moved.end(true)).toBeNull();
  });

  it('commits nothing for a press that never changed the width', () => {
    expect(resizeGesture(start).end(false)).toBeNull();
    const back = resizeGesture(start);
    back.move(160);
    back.move(100);
    expect(back.end(false)).toBeNull();
  });
});
