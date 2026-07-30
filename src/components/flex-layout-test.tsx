import { Layout, Model, TabNode } from 'flexlayout-react';
import 'flexlayout-react/style/alpha_dark.css';
import { Maximize, Minimize, X } from 'lucide-react';

const jsonModel = {
  global: {
    tabSetHeaderHeight: 80,
    tabSetTabStripHeight: 80,
    tabMinWidth: 200,
    tabEnableRename: false,
  },
  layout: {
    type: 'row',
    weight: 100,
    children: [
      {
        type: 'tabset',
        weight: 50,
        children: [
          { type: 'tab', name: 'Panel 1', component: 'default' },
          { type: 'tab', name: 'Panel 2', component: 'default' },
          { type: 'tab', name: 'Panel 3', component: 'default' },
        ],
      },
    ],
  },
};

const model = Model.fromJson(jsonModel);

const factory = (node: TabNode) => {
  return <div className='p-4'>{node.getName()}</div>;
};

export default function TestFlexLayout() {
  return (
    <div className='flexlayout-custom h-full w-full'>
      <Layout
        model={model}
        realtimeResize
        factory={factory}
        icons={{
          close: <X className='size-4' />,  
          maximize: <Maximize className='size-4 text-muted-foreground' />,
          restore: <Minimize className='size-4 text-muted-foreground' />
        }}
        tabDragSpeed={0.1}
      />
      ;
    </div>
  );
}
