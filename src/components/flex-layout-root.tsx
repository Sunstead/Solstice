import { useCallback, useEffect, useRef } from 'react';
import {
  Actions,
  BorderNode,
  Layout,
  Model,
  Orientation,
  RowNode,
  TabNode,
  TabSetNode,
} from 'flexlayout-react';
import 'flexlayout-react/style/alpha_dark.css';
import { Maximize, Minimize, X } from 'lucide-react';
import { useLayout, getActiveTabId } from '@/hooks/use-layout';
import { useWorkspace } from '@/hooks/use-workspace';
import { FileEditor } from '@/components/file-editor';
import { WindowControls } from './window-controls';
import { useIsMac } from '@/hooks/use-platform';

const TOLERANCE = 2;

const TABSET_HEADER_SELECTOR =
  '.flexlayout__tabset_tabbar_outer, .flexlayout__tabset_header_outer';

const DRAG_EXCLUDE_SELECTOR = [
  '.flexlayout__tab_button',
  '.flexlayout__tab_toolbar_button',
  '.no-drag',
].join(', ');

const factory = (node: TabNode) => {
  const component = node.getComponent();
  if (component === 'editor') {
    const config = node.getConfig() as { path?: string } | undefined;
    return <FileEditor path={config?.path ?? ''} />;
  }
  return <div className='p-4'>{node.getName()}</div>;
};

function tagDragRegionRecursive(el: HTMLElement, enable: boolean) {
  if (el.matches(DRAG_EXCLUDE_SELECTOR)) {
    el.removeAttribute('data-tauri-drag-region');
    return;
  }

  if (enable) {
    el.setAttribute('data-tauri-drag-region', '');
  } else {
    el.removeAttribute('data-tauri-drag-region');
  }

  for (const child of Array.from(el.children)) {
    if (child instanceof HTMLElement) tagDragRegionRecursive(child, enable);
  }
}

function findTopRightTabset(model: Model): TabSetNode | undefined {
  const maximizedTabset = model.getMaximizedTabset();
  if (maximizedTabset) return maximizedTabset;

  let node: RowNode | TabSetNode | undefined = model.getRootRow();
  while (node instanceof RowNode) {
    const children = node.getChildren();
    if (children.length === 0) return undefined;
    node = (
      node.getOrientation() === Orientation.HORZ
        ? children[children.length - 1]
        : children[0]
    ) as RowNode | TabSetNode;
  }
  return node instanceof TabSetNode ? node : undefined;
}

function getTopEdgeTabsetIds(model: Model): Set<string> {
  const maximizedTabset = model.getMaximizedTabset();
  if (maximizedTabset) return new Set([maximizedTabset.getId()]);

  const topEdgeIds = new Set<string>();

  const visit = (node: RowNode | TabSetNode, atTopEdge: boolean) => {
    if (node instanceof TabSetNode) {
      if (atTopEdge) topEdgeIds.add(node.getId());
      return;
    }
    const isVertical = node.getOrientation() === Orientation.VERT;
    node.getChildren().forEach((child, index) => {
      visit(child as RowNode | TabSetNode, atTopEdge && (!isVertical || index === 0));
    });
  };

  const rootRow = model.getRootRow();
  if (rootRow) visit(rootRow, true);
  return topEdgeIds;
}

export default function FlexLayoutRoot() {
  const model = useLayout((s) => s.model);
  const loadForWorkspace = useLayout((s) => s.loadForWorkspace);
  const persistCurrent = useLayout((s) => s.persistCurrent);
  const setActiveTabId = useLayout((s) => s.setActiveTabId);
  const workspacePath = useWorkspace((s) => s.path);
  const containerRef = useRef<HTMLDivElement>(null);
  const isMac = useIsMac();

  useEffect(() => {
    if (workspacePath) loadForWorkspace(workspacePath);
  }, [workspacePath, loadForWorkspace]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const onMouseDown = (event: MouseEvent) => {
      if (event.button === 1) event.preventDefault();
    };

    container.addEventListener('mousedown', onMouseDown);
    return () => container.removeEventListener('mousedown', onMouseDown);
  }, []);

  const syncTopEdgeTabsetDrag = useCallback(() => {
    if (!model) return;
    const topEdgeIds = getTopEdgeTabsetIds(model);

    model.visitNodes((node) => {
      if (!(node instanceof TabSetNode)) return;
      const desiredEnableDrag = !topEdgeIds.has(node.getId());
      if (node.isEnableDrag() !== desiredEnableDrag) {
        model.doAction(
          Actions.updateNodeAttributes(node.getId(), { enableDrag: desiredEnableDrag }),
        );
      }
    });
  }, [model]);

  const applyTopEdgeDragRegions = useCallback(() => {
    const containerEl = containerRef.current;
    if (!containerEl) return;
    const containerRect = containerEl.getBoundingClientRect();

    containerEl
      .querySelectorAll<HTMLElement>(TABSET_HEADER_SELECTOR)
      .forEach((bar) => {
        const barRect = bar.getBoundingClientRect();
        const isAtTopEdge = Math.abs(barRect.top - containerRect.top) <= TOLERANCE;
        tagDragRegionRecursive(bar, isAtTopEdge);
      });
  }, []);

  useEffect(() => {
    syncTopEdgeTabsetDrag();
    applyTopEdgeDragRegions();

    const container = containerRef.current;
    if (!container) return;

    const ro = new ResizeObserver(() => applyTopEdgeDragRegions());
    ro.observe(container);
    return () => ro.disconnect();
  }, [syncTopEdgeTabsetDrag, applyTopEdgeDragRegions]);

  const handleAuxMouseClick = (
    node: TabNode | TabSetNode | BorderNode,
    event: React.MouseEvent,
  ) => {
    if (event.button !== 1) return;
    if (!(node instanceof TabNode)) return;
    if (!node.isEnableClose()) return;
    model?.doAction(Actions.deleteTab(node.getId()));
  };

  const handleModelChange = (changedModel: Model) => {
    setActiveTabId(getActiveTabId(changedModel));
    persistCurrent();
    syncTopEdgeTabsetDrag();
    requestAnimationFrame(applyTopEdgeDragRegions);
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
          maximize: <Maximize className='size-4 text-muted-foreground' />,
          restore: <Minimize className='size-4 text-muted-foreground' />,
        }}
        onRenderTabSet={(node, renderValues) => {
          if (isMac) return;
          if (findTopRightTabset(model) !== node) return;
          renderValues.buttons.push(<WindowControls key='win-controls' />);
        }}
        tabDragSpeed={0.1}
      />
    </div>
  );
}