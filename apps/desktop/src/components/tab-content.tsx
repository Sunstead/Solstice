import type { TabNode } from 'flexlayout-react';
import { FileView } from '@/components/file-view';
import { BlankTab } from '@/components/blank-tab';

/** What a tab shows, in flexlayout's tabs or the phone layout's single pane. */
export function TabContent({ node }: { node: TabNode }) {
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
}
