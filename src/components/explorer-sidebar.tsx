import { useEffect } from 'react';
import { useWorkspace } from '@/hooks/use-workspace';
import { useFiles } from '@/hooks/use-files';
import {
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
} from './ui/resizable-sidebar';
import { FileTree } from './file-tree';
import { ContextMenu, ContextMenuTrigger } from './ui/context-menu';
import { FileTreeItemContextMenuContent } from './file-tree-context-menu-content';
import { Button } from './ui/button';
import { FilePlusCorner } from 'lucide-react';

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
    <>
      <SidebarHeader className='px-4 py-2 text-xs font-medium text-muted-foreground'>
        <div className='flex items-center justify-between'>
          <p>Explorer</p>
          <div className='flex items-center'>
            <Button variant='ghost' size='icon-sm'>
              <FilePlusCorner />
            </Button>
          </div>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <ContextMenu>
          <ContextMenuTrigger
            render={
              <SidebarGroup className='h-full py-0'>
                <SidebarGroupContent className='max-w-(--sidebar-width)'>
                  <SidebarMenu className='max-w-(--sidebar-width) gap-0'>
                    <FileTree path={path} />
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            }
          />
          <FileTreeItemContextMenuContent
            renameEnabled={false}
            deleteEnabled={false}
            node={{
              name: path,
              path,
              is_dir: true,
              childrenLoaded: true,
              expanded: true,
            }}
          />
        </ContextMenu>
      </SidebarContent>
    </>
  );
}
