import { describe, expect, it, vi } from 'vitest';

import { watchLayoutDrags } from './layout-drag-end';

function setup() {
  const target = new EventTarget();
  const end = vi.fn();
  const stop = watchLayoutDrags(target, end);
  const fire = (type: string, types: string[] = ['Files'], isTrusted = true) => {
    const event = new Event(type) as Event & { dataTransfer?: unknown };
    event.dataTransfer = { types };
    Object.defineProperty(event, 'isTrusted', { value: isTrusted });
    target.dispatchEvent(event);
  };
  return { end, fire, stop };
}

describe('watchLayoutDrags', () => {
  it('ends the layout’s drag after any drop, which flexlayout leaves counted when it took no part', () => {
    const { end, fire } = setup();
    fire('dragenter');
    fire('drop');
    expect(end).toHaveBeenCalledTimes(1);
  });

  it('ends it after a drag from within the page, however that went', () => {
    const { end, fire } = setup();
    fire('dragend', ['application/json']);
    expect(end).toHaveBeenCalledTimes(1);
  });

  it('ignores the untrusted dragend it sends itself', () => {
    const { end, fire } = setup();
    fire('dragend', [], false);
    expect(end).not.toHaveBeenCalled();
  });

  it('ends it when files from another app are dragged back out of the window', () => {
    const { end, fire } = setup();
    fire('dragenter');
    fire('dragenter');
    fire('dragleave');
    expect(end).not.toHaveBeenCalled();
    fire('dragleave');
    expect(end).toHaveBeenCalledTimes(1);
  });

  it('leaves a tab or tree drag alone when it leaves the window: it may come back', () => {
    const { end, fire } = setup();
    fire('dragenter', ['application/x-solstice-tab']);
    fire('dragleave', ['application/x-solstice-tab']);
    fire('dragenter', ['application/json']);
    fire('dragleave', ['application/json']);
    expect(end).not.toHaveBeenCalled();
  });

  it('counts each drag afresh after a drop', () => {
    const { end, fire } = setup();
    fire('dragenter');
    fire('dragenter');
    fire('drop');
    end.mockClear();
    fire('dragenter');
    fire('dragleave');
    expect(end).toHaveBeenCalledTimes(1);
  });

  it('stops watching', () => {
    const { end, fire, stop } = setup();
    stop();
    fire('drop');
    expect(end).not.toHaveBeenCalled();
  });
});
