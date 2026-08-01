import { create } from 'zustand';
import {
  Model,
  Actions,
  DockLocation,
  TabSetNode,
} from 'flexlayout-react';

type LayoutState = {
  model: Model | null;
  setModel: (model: Model) => void;
  openFile: (path: string, name: string) => void;
};

function findFirstTabset(model: Model): TabSetNode | undefined {
  let found: TabSetNode | undefined;
  model.visitNodes((node) => {
    if (!found && node.getType() === 'tabset') {
      found = node as TabSetNode;
    }
  });
  return found;
}

export const useLayout = create<LayoutState>((set, get) => ({
  model: null,

  setModel: (model) => set({ model }),

  openFile: (path, name) => {
    const { model } = get();
    if (!model) return;

    const existing = model.getNodeById(path);
    if (existing) {
      model.doAction(Actions.selectTab(path));
      return;
    }

    const activeTabset = model.getActiveTabset() ?? findFirstTabset(model);
    if (!activeTabset) return;

    model.doAction(
      Actions.addNode(
        {
          type: 'tab',
          id: path,
          name,
          component: 'editor',
          config: { path },
        },
        activeTabset.getId(),
        DockLocation.CENTER,
        -1,
      ),
    );
  },
}));