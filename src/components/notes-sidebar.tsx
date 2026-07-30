import { useWorkspace } from '@/hooks/use-workspace';
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
} from './ui/resizable-sidebar';
import { useFiles } from '@/hooks/use-files';
import { useEffect } from 'react';
import { FileTree } from './file-tree';

export function NotesSidebar() {
  const { path } = useWorkspace();
  const { entries, loadDirectory } = useFiles();

  useEffect(() => {
    if (!path) return;

    console.log('loading path', path);
    loadDirectory(path);
  }, [path, loadDirectory]);

  useEffect(() => {
    console.log(entries);
  }, [entries]);

  if (!path) {
    return <div>No workspace open</div>;
  }

  return (
    <SidebarGroup>
      <SidebarGroupContent className='max-w-(--sidebar-width)'>
        <SidebarMenu className='max-w-(--sidebar-width)'>
          <FileTree path={path} />
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
