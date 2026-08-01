import { useEffect } from 'react';
import { Layout, Model, TabNode } from 'flexlayout-react';
import 'flexlayout-react/style/alpha_dark.css';
import { Maximize, Minimize, X } from 'lucide-react';
import { useLayout } from '@/hooks/use-layout';
import { FileEditor } from '@/components/file-editor';

const jsonModel = {
  global: {
    tabSetHeaderHeight: 80,
    tabSetTabStripHeight: 80,
    tabMinWidth:  200,
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
        children: [

        ],
      },
    ],
  },
};

const model = Model.fromJson(jsonModel);

const factory = (node: TabNode) => {
  const component = node.getComponent();

  if (component === 'editor') {
    const config = node.getConfig() as { path?: string } | undefined;
    return <FileEditor path={config?.path ?? ''} />;
  }

  return <div className='p-4'>{node.getName()}</div>;
};

export default function FlexLayoutRoot() {
  const setModel = useLayout((s) => s.setModel);

  useEffect(() => {
    setModel(model);
  }, [setModel]);

  return (
    <div className='flexlayout-custom h-full w-full'>
      <Layout
        model={model}
        realtimeResize
        factory={factory}
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