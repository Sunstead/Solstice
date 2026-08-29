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
import { getFileNameFromPath, normalizePath } from '@/lib/path-utils';

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
  openFileInNewTab: (path: string, name: string, location?: 'center' | 'right') => void;
  newBlankTab: (tabsetId?: string) => void;
  normalizeTabsetDeletion: () => void;
  closeFileTab: (path: string) => void;
  closeFolderTabs: (path: string) => void;
  retargetTabs: (from: string, to: string) => void;
  listTabPaths: () => string[];
  /**
   * The path the focused tab has open, or `null` on a blank tab or no tab.
   * Not the same thing as `activeTabId`: a tab's id is fixed at creation and
   * deliberately survives a rename (see `retargetTabs`), so `config.path` is
   * the only thing that still points at the file after one.
   */
  getActiveFilePath: () => string | null;
  /**
   * FlexLayout's imperative `redraw()`, registered by <FlexLayoutRoot>.
   * Tab content is memoized on tabNode *identity* plus FlexLayout's own redraw
   * revisions -- never on config -- and `updateNodeAttributes` mutates a node
   * in place. So changing a tab's `config.path` is invisible to the renderer
   * until something bumps a revision, and this is the only thing that does.
   */
  redrawTabContent: (() => void) | null;
  setRedrawTabContent: (redraw: (() => void) | null) => void;
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

function makeUniqueTabId(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `blank-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

let saveTimeout: ReturnType<typeof setTimeout> | undefined;
let replacingBlankTab = false;

export function isReplacingBlankTab(): boolean {
  return replacingBlankTab;
}

export const useLayout = create<LayoutState>((set, get) => ({
  model: null,
  workspacePath: null,
  activeTabId: null,
  redrawTabContent: null,

  setActiveTabId: (id) => set({ activeTabId: id }),

  setRedrawTabContent: (redraw) => set({ redrawTabContent: redraw }),

  loadForWorkspace: async (path) => {
    const stored = await getStoredLayout();
    let model = Model.fromJson(stored ?? defaultLayoutJson);

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

    // The id is normally the path, which keeps layout JSON readable. But a
    // retargeted tab keeps its original id, so a path can still be taken by a
    // tab that no longer points at it -- `addNode` would throw on the
    // duplicate. Fall back to a synthetic id in that case; `config.path`
    // is the real identity either way.
    const id = model.getNodeById(path) ? makeUniqueTabId() : path;

    const blankTab = findBlankTab(model);
    const blankTabParent = blankTab?.getParent();

    if (blankTab && blankTabParent instanceof TabSetNode) {
      const index = blankTabParent.getChildren().indexOf(blankTab);

      replacingBlankTab = true;
      model.doAction(Actions.deleteTab(blankTab.getId()));
      model.doAction(
        Actions.addNode(
          {
            type: 'tab',
            id,
            name,
            component: 'editor',
            config: { path },
          },
          blankTabParent.getId(),
          DockLocation.CENTER,
          index,
        ),
      );
      replacingBlankTab = false;
      return;
    }

    const activeTabset = model.getActiveTabset() ?? findFirstTabset(model);
    if (!activeTabset) return;

    model.doAction(
      Actions.addNode(
        { type: 'tab', id, name, component: 'editor', config: { path } },
        activeTabset.getId(),
        DockLocation.CENTER,
        -1,
      ),
    );
  },

  /**
   * Unlike `openFile`, this always creates a tab: no selecting an existing
   * one, no reusing a blank tab. That is the whole point of the action -- a
   * second view of a file you already have open, or one parked beside it.
   */
  openFileInNewTab: (path, name, location = 'center') => {
    const { model } = get();
    if (!model) return;

    const activeTabset = model.getActiveTabset() ?? findFirstTabset(model);
    if (!activeTabset) return;

    model.doAction(
      Actions.addNode(
        // Never the path: `openFile` already uses that as the id, so a second
        // tab on the same file would collide and `addNode` would throw.
        { type: 'tab', id: makeUniqueTabId(), name, component: 'editor', config: { path } },
        activeTabset.getId(),
        location === 'right' ? DockLocation.RIGHT : DockLocation.CENTER,
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
          id: makeUniqueTabId(),
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

  closeFileTab: (path) => {
    const { model } = get();
    if (!model) return;

    const wanted = normalizePath(path);
    const idsToClose: string[] = [];

    model.visitNodes((node) => {
      if (node.getType() !== 'tab') return;
      const tab = node as TabNode;
      const config = tab.getConfig() as { path?: string } | undefined;
      if (config?.path && normalizePath(config.path) === wanted) {
        idsToClose.push(tab.getId());
      }
    });

    for (const id of idsToClose) {
      model.doAction(Actions.deleteTab(id));
    }
  },

  closeFolderTabs: (path) => {
    const { model } = get();
    if (!model) return;

    const wanted = normalizePath(path);
    const idsToClose: string[] = [];

    model.visitNodes((node) => {
      if (node.getType() !== 'tab') return;
      const tab = node as TabNode;
      const config = tab.getConfig() as { path?: string } | undefined;
      if (!config?.path) return;

      const tabPath = normalizePath(config.path);
      if (tabPath === wanted || tabPath.startsWith(`${wanted}/`)) {
        idsToClose.push(tab.getId());
      }
    });

    for (const id of idsToClose) {
      model.doAction(Actions.deleteTab(id));
    }
  },

  /**
   * Points every tab at `from` -- or at anything beneath it, so a renamed
   * folder carries its open descendants along -- at the corresponding path
   * under `to`. Tab ids are deliberately left alone: `useNavigationHistory`
   * keys on them, and `config.path` is what actually identifies the file.
   */
  retargetTabs: (from, to) => {
    const { model } = get();
    if (!model) return;

    const oldPath = normalizePath(from);
    const newPath = normalizePath(to);
    const updates: Array<{ id: string; path: string; name: string }> = [];

    // Collected first and applied after: doAction() mutates the tree that
    // visitNodes() is walking.
    model.visitNodes((node) => {
      if (node.getType() !== 'tab') return;
      const tab = node as TabNode;
      const config = tab.getConfig() as { path?: string } | undefined;
      if (!config?.path) return;

      const tabPath = normalizePath(config.path);
      if (tabPath !== oldPath && !tabPath.startsWith(`${oldPath}/`)) return;

      const nextPath = newPath + tabPath.slice(oldPath.length);
      updates.push({
        id: tab.getId(),
        path: nextPath,
        name: getFileNameFromPath(nextPath),
      });
    });

    for (const update of updates) {
      const tab = model.getNodeById(update.id) as TabNode | undefined;
      if (!tab) continue;

      model.doAction(
        Actions.updateNodeAttributes(update.id, {
          name: update.name,
          config: { ...(tab.getConfig() ?? {}), path: update.path },
        }),
      );
    }

    if (updates.length > 0) {
      get().redrawTabContent?.();
      get().persistCurrent();
    }
  },

  listTabPaths: () => {
    const { model } = get();
    if (!model) return [];

    const paths = new Set<string>();

    model.visitNodes((node) => {
      if (node.getType() !== 'tab') return;
      const config = (node as TabNode).getConfig() as
        | { path?: string }
        | undefined;
      if (config?.path) paths.add(config.path);
    });

    return [...paths];
  },

  getActiveFilePath: () => {
    const { model, activeTabId } = get();
    if (!model || !activeTabId) return null;

    const tab = model.getNodeById(activeTabId);
    if (!(tab instanceof TabNode)) return null;

    const config = tab.getConfig() as { path?: string } | undefined;

    return config?.path ?? null;
  },
}));
