import { useCallback, useEffect, useRef } from 'react';
import {
  Actions,
  BorderNode,
  Layout,
  Model,
  TabNode,
  TabSetNode,
} from 'flexlayout-react';
import 'flexlayout-react/style/alpha_dark.css';
import {
  ArrowLeft,
  ArrowRight,
  ChevronDown,
  Maximize,
  Minimize,
  Plus,
  X,
} from 'lucide-react';
import { useLayout, getActiveTabId, modelHasNoTabs } from '@/hooks/use-layout';
import { useWorkspace } from '@/hooks/use-workspace';
import { FileEditor } from '@/components/file-editor';
import { BlankTab } from '@/components/blank-tab';
import { WindowControls } from './window-controls';
import { useIsMac } from '@/hooks/use-platform';
import {
  applyTopEdgeDragRegions,
  findCornerTabset,
  syncTopEdgeTabsetDrag,
} from '@/lib/flexlayout-utils';
import { useSidebar } from './ui/resizable-sidebar';
import { AppMenubar } from './app-menu-dropdown';
import { getFileIcon } from '@/assets/icons';
import { getFileExtension } from '@/lib/utils';
import { Button } from './ui/button';
import { useNavigationHistory } from '@/lib/stores/navigation-history';
import { registerCommand, runCommand, unregisterCommand } from '@/lib/commands';
import { stripPresetExtension } from '@/lib/stores/entry-input';

const factory = (node: TabNode) => {
  const component = node.getComponent();
  if (component === 'editor') {
    const config = node.getConfig() as { path?: string } | undefined;
    return <FileEditor path={config?.path ?? ''} />;
  }
  if (component === 'blank') {
    return <BlankTab tabId={node.getId()} />;
  }
  return <div className='p-4'>{node.getName()}</div>;
};

export default function FlexLayoutRoot() {
  const model = useLayout((s) => s.model);
  const loadForWorkspace = useLayout((s) => s.loadForWorkspace);
  const persistCurrent = useLayout((s) => s.persistCurrent);
  const setActiveTabId = useLayout((s) => s.setActiveTabId);
  const normalizeTabsetDeletion = useLayout((s) => s.normalizeTabsetDeletion);
  const workspacePath = useWorkspace((s) => s.path);
  const containerRef = useRef<HTMLDivElement>(null);
  const isMac = useIsMac();
  const { open: isSidebarOpen } = useSidebar();

  const { visit } = useNavigationHistory();

  const canGoBack = useNavigationHistory((s) => s.past.length > 0);
  const canGoForward = useNavigationHistory((s) => s.future.length > 0);

  const modelRef = useRef<Model | null>(null);
  useEffect(() => {
    modelRef.current = model;
  }, [model]);

  useEffect(() => {
    if (workspacePath) {
      loadForWorkspace(workspacePath);
      useNavigationHistory.getState().reset();
    }
  }, [workspacePath, loadForWorkspace]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const onMouseDown = (event: MouseEvent) => {
      if (event.button === 1) event.preventDefault();
    };

    container.addEventListener('mousedown', onMouseDown, { capture: true });
    return () =>
      container.removeEventListener('mousedown', onMouseDown, {
        capture: true,
      });
  }, []);

  const syncDrag = useCallback(() => {
    if (!model) return;
    syncTopEdgeTabsetDrag(model);
  }, [model]);

  const applyDragRegions = useCallback(() => {
    const containerEl = containerRef.current;
    if (!containerEl) return;
    applyTopEdgeDragRegions(containerEl);
  }, []);

  useEffect(() => {
    syncDrag();
    applyDragRegions();

    const container = containerRef.current;
    if (!container) return;

    const ro = new ResizeObserver(() => applyDragRegions());
    ro.observe(container);
    return () => ro.disconnect();
  }, [syncDrag, applyDragRegions]);

  const handleAuxMouseClick = (
    node: TabNode | TabSetNode | BorderNode,
    event: React.MouseEvent,
  ) => {
    if (event.button !== 1) return;
    if (!(node instanceof TabNode)) return;
    if (!node.isEnableClose()) return;
    model?.doAction(Actions.deleteTab(node.getId()));
  };

  const navigateTo = useCallback((direction: 'back' | 'forward') => {
    const m = modelRef.current;
    if (!m) return;
    const isOpenTab = (id: string) => m.getNodeById(id) instanceof TabNode;
    const store = useNavigationHistory.getState();
    const id =
      direction === 'back' ? store.back(isOpenTab) : store.forward(isOpenTab);
    if (id) m.doAction(Actions.selectTab(id));
  }, []);

  const goBack = useCallback(() => navigateTo('back'), [navigateTo]);
  const goForward = useCallback(() => navigateTo('forward'), [navigateTo]);

  useEffect(() => {
    registerCommand(
      'navigation.back',
      goBack,
      () => useNavigationHistory.getState().past.length > 0,
    );
    registerCommand(
      'navigation.forward',
      goForward,
      () => useNavigationHistory.getState().future.length > 0,
    );
    registerCommand(
      'file.new_tab',
      () => {
        const m = modelRef.current;
        if (!m) return;
        const activeTabset =
          m.getActiveTabset() ?? findCornerTabset(m, 'top-left');
        if (!activeTabset) return;
        useLayout.getState().newBlankTab(activeTabset.getId());
      },
      () => modelRef.current != null,
    );
    registerCommand(
      'file.close_tab',
      () => {
        const m = modelRef.current;
        if (!m) return;
        const activeTabId = getActiveTabId(m);
        if (!activeTabId) return;
        const node = m.getNodeById(activeTabId);
        if (!(node instanceof TabNode) || !node.isEnableClose()) return;
        m.doAction(Actions.deleteTab(activeTabId));
      },
      () => {
        const m = modelRef.current;
        if (!m) return false;
        const activeTabId = getActiveTabId(m);
        if (!activeTabId) return false;
        const node = m.getNodeById(activeTabId);
        return node instanceof TabNode && node.isEnableClose();
      },
    );
    return () => {
      unregisterCommand('navigation.back');
      unregisterCommand('navigation.forward');
      unregisterCommand('file.new_tab');
      unregisterCommand('file.close_tab');
    };
  }, [goBack, goForward]);

  const handleModelChange = (changedModel: Model) => {
    const activeTabId = getActiveTabId(changedModel);
    setActiveTabId(activeTabId);
    if (activeTabId) visit(activeTabId);

    useNavigationHistory
      .getState()
      .prune((id) => changedModel.getNodeById(id) instanceof TabNode);

    persistCurrent();
    syncDrag();
    requestAnimationFrame(applyDragRegions);

    normalizeTabsetDeletion();

    if (modelHasNoTabs(changedModel)) {
      useLayout.getState().newBlankTab();
    }
  };

  if (!model) return null;

  return (
    <div ref={containerRef} className='flexlayout-custom h-full w-full'>
      <Layout
        model={model}
        realtimeResize
        factory={factory}
        onModelChange={handleModelChange}
        onAuxMouseClick={handleAuxMouseClick}
        icons={{
          close: <X className='size-4' />,
          maximize: <Maximize className='size-4' />,
          restore: <Minimize className='size-4' />,
          more: () => <ChevronDown className='size-4' />,
        }}
        tabDragSpeed={0.1}
        onRenderTabSet={(node, renderValues) => {
          const topLeftTabset = findCornerTabset(model, 'top-left');
          const topRightTabset = findCornerTabset(model, 'top-right');

          renderValues.stickyButtons.push(
            <Button
              key={node.getId() + '_addTabButton'}
              variant='ghost'
              size='icon-sm'
              className='no-drag text-muted-foreground'
              onClick={() => useLayout.getState().newBlankTab(node.getId())}
            >
              <Plus />
            </Button>,
          );

          if (node === topLeftTabset && !isSidebarOpen) {
            renderValues.leading = (
              <div className='no-drag flex h-full items-center gap-x-1'>
                <AppMenubar />
                <Button
                  variant='ghost'
                  size='icon-sm'
                  disabled={!canGoBack}
                  onClick={() => runCommand('navigation.back')}
                >
                  <ArrowLeft />
                </Button>
                <Button
                  variant='ghost'
                  size='icon-sm'
                  disabled={!canGoForward}
                  onClick={() => runCommand('navigation.forward')}
                >
                  <ArrowRight />
                </Button>
              </div>
            );
          }

          if (!isMac && node === topRightTabset) {
            renderValues.buttons.push(<WindowControls key='win-controls' />);
          }
        }}
        onRenderTab={(node, renderValues) => {
          if (node.getComponent() === 'editor') {
            const Icon = getFileIcon(getFileExtension(node.getId()));
            renderValues.leading = (
              <div className='size-4'>
                <Icon />
              </div>
            );
          }

          renderValues.content = stripPresetExtension(node.getName()).name;
        }}
      />
    </div>
  );
}
