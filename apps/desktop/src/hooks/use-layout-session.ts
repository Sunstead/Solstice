import { useCallback, useEffect, useRef } from 'react';
import { Actions, type Model, TabNode } from 'flexlayout-react';

import { getActiveTabId, isReplacingBlankTab, modelHasNoTabs, useLayout } from '@/hooks/use-layout';
import { useWorkspace } from '@/hooks/use-workspace';
import { registerCommand, unregisterCommand } from '@/lib/commands';
import { findCornerTabset } from '@/lib/flexlayout-utils';
import { useNavigationHistory } from '@/lib/stores/navigation-history';
import { closeTab } from '@/lib/tab-motion';

/**
 * What the editor area does whichever way it's drawn (flexlayout's tabs, or
 * the phone layout's single pane): load the workspace's layout, answer the
 * tab and history commands, and keep history, persistence and the "never
 * empty" blank tab in step with every model change. Mount it once, in
 * whichever view is showing; it returns that model-change handler.
 */
export function useLayoutSession(afterChange?: () => void) {
  const model = useLayout((s) => s.model);
  const loadForWorkspace = useLayout((s) => s.loadForWorkspace);
  const workspacePath = useWorkspace((s) => s.path);

  const modelRef = useRef<Model | null>(null);
  useEffect(() => {
    modelRef.current = model;
  }, [model]);

  useEffect(() => {
    if (workspacePath) {
      void loadForWorkspace(workspacePath);
      useNavigationHistory.getState().reset();
    }
  }, [workspacePath, loadForWorkspace]);

  const navigateTo = useCallback((direction: 'back' | 'forward') => {
    const m = modelRef.current;
    if (!m) return;
    const isOpenTab = (id: string) => m.getNodeById(id) instanceof TabNode;
    const store = useNavigationHistory.getState();
    const id = direction === 'back' ? store.back(isOpenTab) : store.forward(isOpenTab);
    if (id) m.doAction(Actions.selectTab(id));
  }, []);

  useEffect(() => {
    registerCommand(
      'navigation.back',
      () => navigateTo('back'),
      () => useNavigationHistory.getState().past.length > 0,
    );
    registerCommand(
      'navigation.forward',
      () => navigateTo('forward'),
      () => useNavigationHistory.getState().future.length > 0,
    );
    registerCommand(
      'file.new_tab',
      () => {
        const m = modelRef.current;
        if (!m) return;
        const activeTabset = m.getActiveTabset() ?? findCornerTabset(m, 'top-left');
        if (!activeTabset) return;
        useLayout.getState().newBlankTab(activeTabset.getId());
      },
      () => modelRef.current != null,
    );
    const closable = () => {
      const m = modelRef.current;
      const id = getActiveTabId(m);
      const node = id ? m?.getNodeById(id) : undefined;
      return node instanceof TabNode && node.isEnableClose() ? node : null;
    };
    registerCommand(
      'file.close_tab',
      () => {
        const node = closable();
        if (node && modelRef.current) closeTab(modelRef.current, node.getId(), { pointer: false });
      },
      () => closable() !== null,
    );
    return () => {
      unregisterCommand('navigation.back');
      unregisterCommand('navigation.forward');
      unregisterCommand('file.new_tab');
      unregisterCommand('file.close_tab');
    };
  }, [navigateTo]);

  const afterRef = useRef(afterChange);
  useEffect(() => {
    afterRef.current = afterChange;
  }, [afterChange]);

  return useCallback((changed: Model) => {
    const layout = useLayout.getState();
    const activeTabId = getActiveTabId(changed);
    layout.setActiveTabId(activeTabId);
    if (activeTabId) useNavigationHistory.getState().visit(activeTabId);
    useNavigationHistory.getState().prune((id) => changed.getNodeById(id) instanceof TabNode);

    layout.persistCurrent();
    afterRef.current?.();
    layout.normalizeTabsetDeletion();

    if (modelHasNoTabs(changed) && !isReplacingBlankTab()) layout.newBlankTab();
  }, []);
}
