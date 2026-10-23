import { describe, expect, it } from 'vitest';
import { Model } from 'flexlayout-react';

import { TAB_TYPE, decodeTab, dragData, encodeTab, isTabDrag, shouldTearOff, tabPayload } from './tab-transfer';

function model() {
  return Model.fromJson({
    global: {},
    layout: {
      type: 'row',
      children: [
        {
          type: 'tabset',
          children: [
            { type: 'tab', id: 'a', name: 'A.md', component: 'editor', config: { path: '/ws/A.md', mode: 'source' } },
            { type: 'tab', id: 'b', name: 'New Tab', component: 'blank' },
          ],
        },
      ],
    },
  });
}

describe('tabPayload', () => {
  it('carries what the tab shows, not its id', () => {
    const p = tabPayload(model(), 'a', { source: 'main', workspace: '/ws' })!;
    expect(p).toEqual({
      source: 'main',
      tabId: 'a',
      workspace: '/ws',
      json: { type: 'tab', name: 'A.md', component: 'editor', config: { path: '/ws/A.md', mode: 'source' } },
    });
  });

  it('is nothing for a node that is not a tab', () => {
    expect(tabPayload(model(), 'missing', { source: 'main', workspace: '/ws' })).toBeNull();
  });

  it('round-trips, and refuses anything else', () => {
    const p = tabPayload(model(), 'b', { source: 'w-1', workspace: '/ws' })!;
    expect(decodeTab(encodeTab(p))).toEqual(p);
    expect(decodeTab('--flexlayout--')).toBeNull();
    expect(decodeTab('{"source":1}')).toBeNull();
    expect(decodeTab(null)).toBeNull();
  });
});

describe('shouldTearOff', () => {
  it('tears off a tab let go of outside every window', () => {
    expect(shouldTearOff({ dropEffect: 'none', inside: false, over: null })).toBe(true);
  });

  it('leaves a drop another window took, or one over another window', () => {
    expect(shouldTearOff({ dropEffect: 'move', inside: false, over: null })).toBe(false);
    // WebKit can report none for a drop another window took: being over it is enough.
    expect(shouldTearOff({ dropEffect: 'none', inside: false, over: 'w-2' })).toBe(false);
  });

  it('leaves a drag cancelled inside its own window', () => {
    expect(shouldTearOff({ dropEffect: 'none', inside: true, over: null })).toBe(false);
  });
});

describe('isTabDrag', () => {
  it('is a drag carrying a tab, whatever else it carries', () => {
    expect(isTabDrag([TAB_TYPE])).toBe(true);
    expect(isTabDrag(['text/plain', TAB_TYPE])).toBe(true);
    expect(isTabDrag(['text/plain'])).toBe(false);
    expect(isTabDrag(undefined)).toBe(false);
  });
});

describe('dragData', () => {
  it('offers other apps no text, only the tab', () => {
    const data = new Map<string, string>([['text/plain', '--flexlayout--']]);
    const transfer = {
      clearData: () => data.clear(),
      setData: (type: string, value: string) => void data.set(type, value),
    };
    dragData(transfer, 'main');
    expect([...data.keys()]).toEqual([TAB_TYPE]);
  });
});
