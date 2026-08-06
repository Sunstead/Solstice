import { useEffect, useRef } from 'react';
import {
  Actions,
  BorderNode,
  Layout,
  Model,
  TabNode,
  TabSetNode,
} from 'flexlayout-react';
import 'flexlayout-react/style/alpha_dark.css';
import { Maximize, Minimize, X } from 'lucide-react';
import { useLayout, getActiveTabId } from '@/hooks/use-layout';
import { useWorkspace } from '@/hooks/use-workspace';
import { FileEditor } from '@/components/file-editor';

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
  };

  if (!model) return null; // or a skeleton while the stored layout loads

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
      />
    </div>
  );
}
