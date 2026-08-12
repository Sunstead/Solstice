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
import { Maximize, Minimize, Plus, X } from 'lucide-react';
import { useLayout, getActiveTabId } from '@/hooks/use-layout';
import { useWorkspace } from '@/hooks/use-workspace';
import { FileEditor } from '@/components/file-editor';
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

const factory = (node: TabNode) => {
  const component = node.getComponent();
  if (component === 'editor') {
    const config = node.getConfig() as { path?: string } | undefined;
    return <FileEditor path={config?.path ?? ''} />;
  }
  return <div className='p-4'>{node.getName()}</div>;
};

export default function FlexLayoutRoot() {
  const model = useLayout((s) => s.model);
  const loadForWorkspace = useLayout((s) => s.loadForWorkspace);
  const persistCurrent = useLayout((s) => s.persistCurrent);
  const setActiveTabId = useLayout((s) => s.setActiveTabId);
  const workspacePath = useWorkspace((s) => s.path);
  const containerRef = useRef<HTMLDivElement>(null);
  const isMac = useIsMac();
  const { open: isSidebarOpen } = useSidebar();

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

  const handleModelChange = (changedModel: Model) => {
    setActiveTabId(getActiveTabId(changedModel));
    persistCurrent();
    syncDrag();
    requestAnimationFrame(applyDragRegions);
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
        tabDragSpeed={0.1}
        onRenderTabSet={(node, renderValues) => {
          const topLeftTabset = findCornerTabset(model, 'top-left');
          const topRightTabset = findCornerTabset(model, 'top-right');

          renderValues.stickyButtons.push(
            <Button variant='ghost' size='icon-sm' className='no-drag text-muted-foreground'>
              <Plus />
            </Button>,
          );

          if (node === topLeftTabset && !isSidebarOpen) {
            renderValues.leading = (
              <div className='no-drag flex h-full items-center gap-x-2'>
                <AppMenubar />
              </div>
            );
          }

          if (!isMac && node === topRightTabset) {
            renderValues.buttons.push(<WindowControls key='win-controls' />);
          }
        }}
        onRenderTab={(node, renderValues) => {
          const Icon = getFileIcon(getFileExtension(node.getId()));

          renderValues.leading = (
            <div className='size-4'>
              <Icon />
            </div>
          );
        }}
      />
    </div>
  );
}
