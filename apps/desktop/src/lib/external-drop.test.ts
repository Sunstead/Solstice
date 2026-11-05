import { Model, TabNode } from 'flexlayout-react';
import { describe, expect, it } from 'vitest';

import { fillDropped, isOsFileDrag } from './external-drop';

const model = () =>
  Model.fromJson({
    global: {},
    layout: {
      type: 'row',
      children: [
        {
          type: 'tabset',
          id: 'set',
          children: [
            { type: 'tab', id: 'a', name: 'a.md', component: 'editor', config: { path: '/w/a.md' } },
            { type: 'tab', id: 'drop', name: 'Opening…', component: 'blank' },
            { type: 'tab', id: 'b', name: 'b.md', component: 'editor', config: { path: '/w/b.md' } },
          ],
        },
      ],
    },
  });

const strip = (m: Model, set = 'set') =>
  (m.getNodeById(set)!.getChildren() as TabNode[]).map((t) => (t.getConfig() as { path?: string } | undefined)?.path ?? t.getId());

describe('fillDropped', () => {
  it('puts the dropped files where the drop landed, in order', () => {
    const m = model();
    fillDropped(m, 'drop', ['/Downloads/x.md', '/Downloads/y.py']);
    expect(strip(m)).toEqual(['/w/a.md', '/Downloads/x.md', '/Downloads/y.py', '/w/b.md']);
  });

  it('takes the placeholder away when the drop had no files', () => {
    const m = model();
    fillDropped(m, 'drop', []);
    expect(strip(m)).toEqual(['/w/a.md', '/w/b.md']);
  });
});

describe('fillDropped in a new split', () => {
  // A drop at a pane's edge: a tabset of its own, with nothing but the placeholder.
  const split = () =>
    Model.fromJson({
      global: {},
      layout: {
        type: 'row',
        children: [
          {
            type: 'tabset',
            id: 'left',
            children: [{ type: 'tab', id: 'a', name: 'a.md', component: 'editor', config: { path: '/w/a.md' } }],
          },
          { type: 'tabset', id: 'right', children: [{ type: 'tab', id: 'drop', name: 'Opening…', component: 'blank' }] },
        ],
      },
    });

  it('keeps the split, which would go with its last tab', () => {
    const m = split();
    fillDropped(m, 'drop', ['/Downloads/x.md', '/Downloads/y.md']);
    expect(strip(m, 'right')).toEqual(['/Downloads/x.md', '/Downloads/y.md']);
  });

  it('lets the split go when the drop had no files', () => {
    const m = split();
    fillDropped(m, 'drop', []);
    expect(m.getNodeById('right')).toBeUndefined();
  });
});

describe('isOsFileDrag', () => {
  const transfer = (types: string[]) => ({ types }) as unknown as DataTransfer;
  it('is a drag of files from another app', () => {
    expect(isOsFileDrag(transfer(['Files']))).toBe(true);
  });
  it('is not a tab or the tree being dragged', () => {
    expect(isOsFileDrag(transfer(['application/x-solstice-tab']))).toBe(false);
    expect(isOsFileDrag(transfer(['text/plain']))).toBe(false);
    expect(isOsFileDrag(null)).toBe(false);
  });
});
