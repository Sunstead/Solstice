import { create } from 'zustand';
import {
  Model,
  Actions,
  DockLocation,
  TabSetNode,
  IJsonModel,
} from 'flexlayout-react';
import {
  getStoredLayout,
  setStoredLayout,
} from '@/lib/stores/workspace-layout';

const defaultLayoutJson: IJsonModel = {
  global: {
    tabEnableRename: false,
    enableEdgeDockIndicators: false,
  },
  layout: {
    type: 'row',
    weight: 100,
    children: [{ type: 'tabset', weight: 50, children: [] }],
  },
};

type LayoutState = {
  model: Model | null;
  workspacePath: string | null;
  activeTabId: string | null;
  setActiveTabId: (id: string | null) => void;
  loadForWorkspace: (path: string) => Promise<void>;
  persistCurrent: () => void;
  openFile: (path: string, name: string) => void;
};

function findFirstTabset(model: Model): TabSetNode | undefined {
  let found: TabSetNode | undefined;
  model.visitNodes((node) => {
    if (!found && node.getType() === 'tabset') found = node as TabSetNode;
  });
  return found;
}

export function getActiveTabId(model: Model | null): string | null {
  if (!model) return null;
  const activeTabset = model.getActiveTabset();
  if (!activeTabset) return null;
  const selected = activeTabset.getSelectedNode();
  return selected?.getId() ?? null;
}

let saveTimeout: ReturnType<typeof setTimeout> | undefined;

export const useLayout = create<LayoutState>((set, get) => ({
  model: null,
  workspacePath: null,
  activeTabId: null,

  setActiveTabId: (id) => set({ activeTabId: id }),

  loadForWorkspace: async (path) => {
    const stored = await getStoredLayout();
    const model = Model.fromJson(stored ?? defaultLayoutJson);
    set({
      model,
      workspacePath: path,
      activeTabId: getActiveTabId(model),
    });
  },

  persistCurrent: () => {
    const { model, workspacePath } = get();
    if (!model || !workspacePath) return;

    clearTimeout(saveTimeout);
    saveTimeout = setTimeout(() => {
      setStoredLayout(model.toJson());
    }, 300);
  },

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
        { type: 'tab', id: path, name, component: 'editor', config: { path } },
        activeTabset.getId(),
        DockLocation.CENTER,
        -1,
      ),
    );
  },
}));
