import { useCallback, useEffect, useMemo, useRef } from 'react';
import { isDesktop } from '@/lib/backend';
import {
  Actions,
  BorderNode,
  Layout,
  Model,
  TabNode,
  TabSetNode,
} from 'flexlayout-react';
import type { ILayoutApi } from 'flexlayout-react';
import 'flexlayout-react/style/alpha_dark.css';
import {
  ChevronDown,
  Maximize,
  Minimize,
  Plus,
} from 'lucide-react';
import {
  useLayout,
  getActiveTabId,
  modelHasNoTabs,
  isReplacingBlankTab,
} from '@/hooks/use-layout';
import { useWorkspace } from '@/hooks/use-workspace';
import { useFileTreeDragState } from '@/hooks/use-file-tree-drag-state';
import { useFileTreeExternalDropZone } from '@/hooks/use-file-tree-dnd';
import { FileView } from '@/components/file-view';
import { BlankTab } from '@/components/blank-tab';
import { WindowControls } from './window-controls';
import { useIsMac } from '@/hooks/use-platform';
import {
  applyTopEdgeDragRegions,
  findCornerTabset,
  syncTopEdgeTabsetDrag,
} from '@/lib/flexlayout-utils';
import { HeaderControlsSpacer } from './header-controls';
import { getFileIcon } from '@/assets/icons';
import { getFileExtension } from '@/lib/utils';
import { Button } from '@sunstead/ui/components/button';
import { useNavigationHistory } from '@/lib/stores/navigation-history';
import { registerCommand, unregisterCommand } from '@/lib/commands';
import { stripPresetExtension } from '@/lib/stores/entry-input';
import { useSetting } from '@/lib/settings/store';
import { TabCloseIcon } from './tab-close-icon';

function makeDraggedTabId(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `dragged-tab-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

const factory = (node: TabNode) => {
  const component = node.getComponent();
  if (component === 'editor') {
    const config = node.getConfig() as { path?: string } | undefined;
    // Not necessarily an editor: FileView picks a viewer for non-markdown
    // files, which the tab component name predates.
    return <FileView path={config?.path ?? ''} />;
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
  // Subscribed here so flipping the setting re-renders <Layout>, which is what
  // makes onRenderTab below run again with the new value.
  const showExtensions = useSetting('explorer.showFileExtensions');

  // Retargeting a tab after a rename mutates its config in place, which
  // FlexLayout's content memo cannot see. Hand the store the imperative
  // redraw so it can force those tabs to re-render.
  const layoutRef = useRef<ILayoutApi>(null);
  const setRedrawTabContent = useLayout((s) => s.setRedrawTabContent);

  useEffect(() => {
    setRedrawTabContent(() => layoutRef.current?.redraw());
    return () => setRedrawTabContent(null);
  }, [setRedrawTabContent]);

  // Registers containerRef as a react-dnd drop target so react-dnd's own
  // cursor/drop-permission logic doesn't fight with FlexLayout's — see
  // useFileTreeExternalDropZone for why this is necessary. FlexLayout's
  // onExternalDrag (below) still does the actual work of accepting the
  // drop and creating the tab.
  const externalDrop = useFileTreeExternalDropZone();
  externalDrop(containerRef);

  // Stable, so swapping the close icon for a save spinner is driven by
  // TabCloseIcon's own subscription rather than by re-rendering every tab.
  const layoutIcons = useMemo(
    () => ({
      close: (tabNode: TabNode) => <TabCloseIcon node={tabNode} />,
      maximize: <Maximize className='size-4' />,
      restore: <Minimize className='size-4' />,
      more: () => <ChevronDown className='size-4' />,
    }),
    [],
  );

  const { visit } = useNavigationHistory();

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

    if (modelHasNoTabs(changedModel) && !isReplacingBlankTab()) {
      useLayout.getState().newBlankTab();
    }
  };

  // Lets a file dragged from the explorer be dropped directly onto a
  // specific tabset/position in the editor area. FlexLayout owns the drag
  // affordances here (insertion indicator, target tabset resolution) — we
  // only decide *whether* to accept the drag and *what* tab it becomes.
  //
  // The native DragEvent can't tell us which file is being dragged: browsers
  // withhold dataTransfer payload data until the actual `drop`, and this
  // drag isn't a react-dnd consumer to begin with. So we read the currently-
  // dragged entry out of useFileTreeDragState instead — see that store for
  // why. If nothing's there, this is some other external drag (e.g. from the
  // OS) and we reject it.
  //
  // Deliberately does NOT dedup against already-open tabs the way clicking
  // a file in the explorer does. Dragging is a positional gesture — the
  // person is choosing *where* to put a view of the file, which is a
  // reasonable way to open a second view of something already open
  // elsewhere (e.g. side-by-side). So the tab id is generated fresh each
  // time rather than reusing `entry.path`, since FlexLayout requires unique
  // ids and this can now create more than one tab for the same file.
  // `config.path` — not `id` — is what carries the file's identity from
  // here on; anything that needs to know which file a tab points to
  // (FileEditor's factory, onRenderTab below, closeFileTab) reads that.
  const handleExternalDrag = useCallback(
    (_event: React.DragEvent<HTMLElement>) => {
      const entry = useFileTreeDragState.getState().draggedEntry;
      if (!entry || entry.is_dir) return undefined;

      return {
        json: {
          id: makeDraggedTabId(),
          name: entry.name,
          component: 'editor',
          config: { path: entry.path },
        },
        // Called once this specific drag's drop completes (or is
        // cancelled) — the natural place to clear the tracked drag entry,
        // since it's scoped to this drag rather than a global Layout event.
        onDrop: () => {
          useFileTreeDragState.getState().setDraggedEntry(null);
        },
      };
    },
    [],
  );

  if (!model) return null;

  return (
    <div ref={containerRef} className='flexlayout-custom h-full w-full'>
      <Layout
        ref={layoutRef}
        model={model}
        realtimeResize
        factory={factory}
        onModelChange={handleModelChange}
        onAuxMouseClick={handleAuxMouseClick}
        onExternalDrag={handleExternalDrag}
        icons={layoutIcons}
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

          // The header controls overhang this tabset when the sidebar is
          // collapsed; the spacer makes room for them.
          if (node === topLeftTabset) {
            renderValues.leading = <HeaderControlsSpacer />;
          }

          // A browser tab has its own window controls.
          if (isDesktop && !isMac && node === topRightTabset) {
            renderValues.buttons.push(<WindowControls key='win-controls' />);
          }
        }}
        onRenderTab={(node, renderValues) => {
          if (node.getComponent() === 'editor') {
            // Read the file path from config, not the tab id — drag-opened
            // tabs no longer use the path as their id (see
            // handleExternalDrag), since more than one such tab can now
            // point at the same file.
            const config = node.getConfig() as { path?: string } | undefined;
            const Icon = getFileIcon(getFileExtension(config?.path ?? ''));
            renderValues.leading = (
              <div className='size-4'>
                <Icon />
              </div>
            );
          }

          renderValues.content = showExtensions
            ? node.getName()
            : stripPresetExtension(node.getName()).name;
        }}
      />
    </div>
  );
}
