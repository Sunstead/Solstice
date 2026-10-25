import { describe, expect, it } from 'vitest';
import { Actions, Model, TabNode, TabSetNode, type IJsonTabSetNode } from 'flexlayout-react';
import { applyTabMode, applyZen } from '@/lib/flexlayout-utils';

const tabset = (id: string, tabs: string[], extra: Partial<IJsonTabSetNode> = {}): IJsonTabSetNode => ({
  type: 'tabset',
  id,
  enableDeleteWhenEmpty: false,
  children: tabs.map((t) => ({ type: 'tab', id: t, name: t, component: 'blank' })),
  ...extra,
});

function split() {
  return Model.fromJson({
    global: {},
    layout: {
      type: 'row',
      children: [
        tabset('left', ['a', 'b']),
        { type: 'row', children: [tabset('top', ['c']), tabset('bottom', ['d', 'e'], { selected: 1, active: true })] },
      ],
    },
  });
}

function tabsets(model: Model): TabSetNode[] {
  const found: TabSetNode[] = [];
  model.visitNodes((node) => {
    if (node instanceof TabSetNode) found.push(node);
  });
  return found;
}

describe('applyTabMode', () => {
  it('puts every tab in one tabset, in layout order, keeping the shown one', () => {
    const model = split();
    applyTabMode(model, true);

    const [only, ...others] = tabsets(model);
    expect(others).toEqual([]);
    expect(only.getChildren().map((t) => t.getId())).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect((model.getActiveTabset()?.getSelectedNode() as TabNode).getId()).toBe('e');
  });

  it('turns splitting off, and back on', () => {
    const model = split();
    applyTabMode(model, true);
    expect(model.toJson().global).toMatchObject({ tabSetEnableDivide: false, enableEdgeDock: false });

    applyTabMode(model, false);
    // Back to flexlayout's defaults, which it leaves out of the saved layout.
    const global = model.toJson().global ?? {};
    expect([global.tabSetEnableDivide ?? true, global.enableEdgeDock ?? true]).toEqual([true, true]);
    expect(tabsets(model)).toHaveLength(1);
  });

  it('leaves a single tabset as it is', () => {
    const model = Model.fromJson({
      global: {},
      layout: { type: 'row', children: [tabset('only', ['a', 'b'], { selected: 1 })] },
    });
    applyTabMode(model, true);
    const only = model.getNodeById('only') as TabSetNode;
    expect(only.getChildren().map((t) => t.getId())).toEqual(['a', 'b']);
    expect(only.getSelectedNode()?.getId()).toBe('b');
  });
});

describe('applyZen', () => {
  it('maximizes the active tabset, and restores the split on exit', () => {
    const model = split();
    applyZen(model, true);
    expect(model.getMaximizedTabset()?.getId()).toBe('bottom');

    applyZen(model, false);
    expect(model.getMaximizedTabset()).toBeUndefined();
    expect(tabsets(model)).toHaveLength(3);
  });

  it('follows the active tabset when it changes', () => {
    const model = split();
    applyZen(model, true);
    model.doAction(Actions.setActiveTabset('left'));
    applyZen(model, true);
    expect(model.getMaximizedTabset()?.getId()).toBe('left');
  });

  it('is a no-op with one tabset', () => {
    const model = split();
    applyTabMode(model, true);
    applyZen(model, true);
    expect(model.getMaximizedTabset()).toBeUndefined();
  });
});
