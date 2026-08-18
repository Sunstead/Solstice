import { create } from 'zustand';
import {
  Model,
  Actions,
  DockLocation,
  TabNode,
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
    children: [
      {
        type: 'tabset',
        weight: 50,
        children: [],
      },
    ],
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
  newBlankTab: (tabsetId?: string) => void;
  normalizeTabsetDeletion: () => void;
};

function findFirstTabset(model: Model): TabSetNode | undefined {
  let found: TabSetNode | undefined;
  model.visitNodes((node) => {
    if (!found && node.getType() === 'tabset') found = node as TabSetNode;
  });
  return found;
}

function collectTabsets(model: Model): TabSetNode[] {
  const tabsets: TabSetNode[] = [];
  model.visitNodes((node) => {
    if (node.getType() === 'tabset') tabsets.push(node as TabSetNode);
  });
  return tabsets;
}

function findBlankTab(model: Model): TabNode | undefined {
  let found: TabNode | undefined;
  model.visitNodes((node) => {
    if (
      !found &&
      node.getType() === 'tab' &&
      (node as TabNode).getComponent() === 'blank'
    ) {
      found = node as TabNode;
    }
  });
  return found;
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+$/, '');
}

function findTabForPath(model: Model, path: string): TabNode | undefined {
  const wanted = normalizePath(path);
  let found: TabNode | undefined;

  model.visitNodes((node) => {
    if (found || node.getType() !== 'tab') return;
    const tab = node as TabNode;
    const config = tab.getConfig() as { path?: string } | undefined;
    if (config?.path && normalizePath(config.path) === wanted) found = tab;
  });

  return found;
}

function syncTabsetDeletion(model: Model): void {
  const tabsets = collectTabsets(model);
  const desiredEnableDeleteWhenEmpty = tabsets.length > 1;

  for (const tabset of tabsets) {
    if (tabset.isEnableDeleteWhenEmpty() !== desiredEnableDeleteWhenEmpty) {
      model.doAction(
        Actions.updateNodeAttributes(tabset.getId(), {
          enableDeleteWhenEmpty: desiredEnableDeleteWhenEmpty,
        }),
      );
    }
  }
}

export function getActiveTabId(model: Model | null): string | null {
  if (!model) return null;
  const activeTabset = model.getActiveTabset();
  if (!activeTabset) return null;
  const selected = activeTabset.getSelectedNode();
  return selected?.getId() ?? null;
}

export function modelHasNoTabs(model: Model): boolean {
  let found = false;
  model.visitNodes((node) => {
    if (node.getType() === 'tab') found = true;
  });
  return !found;
}

function nextBlankTabName(model: Model): string {
  let count = 0;
  model.visitNodes((node) => {
    if (
      node.getType() === 'tab' &&
      (node as TabNode).getComponent() === 'blank'
    ) {
      count += 1;
    }
  });
  return count === 0 ? 'New Tab' : `New Tab ${count + 1}`;
}

function makeBlankTabId(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `blank-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

let saveTimeout: ReturnType<typeof setTimeout> | undefined;

export const useLayout = create<LayoutState>((set, get) => ({
  model: null,
  workspacePath: null,
  activeTabId: null,

  setActiveTabId: (id) => set({ activeTabId: id }),

  loadForWorkspace: async (path) => {
    const stored = await getStoredLayout();
    let model = Model.fromJson(stored ?? defaultLayoutJson);

    // Safety net: if a stored layout was somehow saved with zero tabsets,
    // fall back to a fresh default rather than ending up with nowhere to
    // open a tab.
    if (collectTabsets(model).length === 0) {
      model = Model.fromJson(defaultLayoutJson);
    }

    syncTabsetDeletion(model);

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

    const existing = findTabForPath(model, path);
    if (existing) {
      model.doAction(Actions.selectTab(existing.getId()));
      return;
    }

    const blankTab = findBlankTab(model);
    const blankTabParent = blankTab?.getParent();

    if (blankTab && blankTabParent instanceof TabSetNode) {
      const index = blankTabParent.getChildren().indexOf(blankTab);

      model.doAction(Actions.deleteTab(blankTab.getId()));
      model.doAction(
        Actions.addNode(
          {
            type: 'tab',
            id: path,
            name,
            component: 'editor',
            config: { path },
          },
          blankTabParent.getId(),
          DockLocation.CENTER,
          index,
        ),
      );
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

  newBlankTab: (tabsetId) => {
    const { model } = get();
    if (!model) return;

    const targetTabset = tabsetId
      ? (model.getNodeById(tabsetId) as TabSetNode | undefined)
      : (model.getActiveTabset() ?? findFirstTabset(model));
    if (!targetTabset) return;

    model.doAction(
      Actions.addNode(
        {
          type: 'tab',
          id: makeBlankTabId(),
          name: nextBlankTabName(model),
          component: 'blank',
        },
        targetTabset.getId(),
        DockLocation.CENTER,
        -1,
      ),
    );
  },

  normalizeTabsetDeletion: () => {
    const { model } = get();
    if (!model) return;
    syncTabsetDeletion(model);
  },
}));