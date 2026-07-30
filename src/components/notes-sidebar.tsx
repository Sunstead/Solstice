import { useEffect } from 'react';
import { useWorkspace } from '@/hooks/use-workspace';
import { useFiles } from '@/hooks/use-files';
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
} from './ui/resizable-sidebar';
import { FileTree } from './file-tree';

export function NotesSidebar() {
  const path = useWorkspace((s) => s.path);
  const loading = useWorkspace((s) => s.loading);
  const loadDirectory = useFiles((s) => s.loadDirectory);

  useEffect(() => {
    if (!path) return;
    loadDirectory(path);
  }, [path, loadDirectory]);

  if (loading) {
    return null;
  }

  if (!path) {
    return <div>No workspace open</div>;
  }

  return (
    <SidebarGroup>
      <SidebarGroupContent className='max-w-(--sidebar-width)'>
        <SidebarMenu className='max-w-(--sidebar-width) gap-0'>
          <FileTree path={path} />
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
