import { useEffect } from 'react';
import {
  Actions,
  BorderNode,
  Layout,
  TabNode,
  TabSetNode,
} from 'flexlayout-react';
import 'flexlayout-react/style/alpha_dark.css';
import { Maximize, Minimize, X } from 'lucide-react';
import { useLayout } from '@/hooks/use-layout';
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
  const workspacePath = useWorkspace((s) => s.path);

  useEffect(() => {
    if (workspacePath) loadForWorkspace(workspacePath);
  }, [workspacePath, loadForWorkspace]);

  const handleAuxMouseClick = (
    node: TabNode | TabSetNode | BorderNode,
    event: React.MouseEvent,
  ) => {
    if (event.button !== 1) return;
    if (!(node instanceof TabNode)) return;
    if (!node.isEnableClose()) return;
    model?.doAction(Actions.deleteTab(node.getId()));
  };

  if (!model) return null; // or a skeleton while the stored layout loads

  return (
    <div className='flexlayout-custom h-full w-full'>
      <Layout
        model={model}
        realtimeResize
        factory={factory}
        onModelChange={persistCurrent}
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
