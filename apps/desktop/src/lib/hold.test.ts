// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/haptics', () => ({ haptics: { prepare: () => {}, play: () => {} } }));

import { useHold } from './hold';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** A list with a hold of its own (its empty space), holding a row with its own. */
function List({ onList, onRow }: { onList: () => void; onRow: () => void }) {
  const list = useHold(onList);
  const row = useHold(onRow);
  return createElement('div', { id: 'list', ...list }, createElement('div', { id: 'row', ...row }));
}

let root: Root;
let host: HTMLElement;
const onList = vi.fn();
const onRow = vi.fn();

beforeEach(() => {
  vi.useFakeTimers();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() => root.render(createElement(List, { onList, onRow })));
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
  onList.mockReset();
  onRow.mockReset();
});

function press(id: string) {
  const el = document.getElementById(id)!;
  // jsdom has no PointerEvent; React reads these fields off any event.
  const down = new MouseEvent('pointerdown', { bubbles: true, clientX: 10, clientY: 10 });
  Object.assign(down, { pointerType: 'touch', isPrimary: true, pointerId: 1 });
  act(() => {
    el.dispatchEvent(down);
    vi.advanceTimersByTime(500);
  });
}

describe('useHold', () => {
  it('opens only the innermost hold’s menu when holds are nested', () => {
    press('row');
    expect(onRow).toHaveBeenCalledTimes(1);
    expect(onList).not.toHaveBeenCalled();
  });

  it('holds the outer one where nothing inside claims the press', () => {
    press('list');
    expect(onList).toHaveBeenCalledTimes(1);
    expect(onRow).not.toHaveBeenCalled();
  });

  it('opens only the innermost menu for a right click too', () => {
    act(() => {
      document.getElementById('row')!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    });
    expect(onRow).toHaveBeenCalledTimes(1);
    expect(onList).not.toHaveBeenCalled();
  });
});
