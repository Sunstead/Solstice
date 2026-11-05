import { vi } from 'vitest';

/**
 * Web Animations and rAF for jsdom, which has neither: each animation is
 * recorded, held at its first keyframe until it finishes or is cancelled,
 * and frames run only when a test asks.
 */
export type FakeAnimation = {
  el: Element;
  keyframes: Keyframe[];
  state: 'paused' | 'running' | 'finished' | 'idle';
  finish(): void;
};

export function fakeMotion() {
  const animations: FakeAnimation[] = [];
  let frames = new Map<number, FrameRequestCallback>();
  let next = 1;

  const animate = function (this: Element, keyframes: Keyframe[]) {
    let resolve!: () => void;
    let reject!: (e: unknown) => void;
    const finished = new Promise<void>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    // As browsers do: a cancelled animation's rejection is marked handled.
    finished.catch(() => {});
    const fake: FakeAnimation = {
      el: this,
      keyframes,
      state: 'running',
      finish: () => {
        if (fake.state === 'idle' || fake.state === 'finished') return;
        fake.state = 'finished';
        resolve();
      },
    };
    animations.push(fake);
    return {
      finished,
      pause: () => fake.state === 'running' && (fake.state = 'paused'),
      play: () => fake.state === 'paused' && (fake.state = 'running'),
      cancel: () => {
        if (fake.state === 'idle' || fake.state === 'finished') return;
        fake.state = 'idle';
        reject(new DOMException('cancelled', 'AbortError'));
      },
    } as unknown as Animation;
  };

  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    frames.set(next, cb);
    return next++;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  const realAnimate = Element.prototype.animate;
  Element.prototype.animate = animate as unknown as typeof Element.prototype.animate;

  return {
    animations,
    /** Animations on `el` still running or held. */
    live: (el: Element) => animations.filter((a) => a.el === el && (a.state === 'paused' || a.state === 'running')),
    /** Runs every frame asked for so far (and those they ask for, up to `count` rounds). */
    frame(count = 1) {
      for (let i = 0; i < count; i++) {
        const now = frames;
        frames = new Map();
        now.forEach((cb) => cb(performance.now()));
      }
    },
    pendingFrames: () => frames.size,
    restore() {
      Element.prototype.animate = realAnimate;
      vi.unstubAllGlobals();
    },
  };
}

/** Lets promise callbacks run. */
export const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
