import { useEffect, useRef } from 'react';
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
import { FileTreeDragLayer } from './file-tree-drag-layer';
import { useFileTreeDrop } from '@/hooks/use-file-tree-dnd';
import { cn } from '@/lib/utils';
import { Button } from './ui/button';
import { Plus } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';
import {
  FILE_TYPE_PRESETS,
  FileTypePreset,
  useEntryInput,
} from '@/lib/stores/entry-input';
import { getFileIcon, getFolderIcon } from '@/assets/icons';
import { useDragHoverStore } from '@/hooks/use-drag-hover';

export function ExplorerSidebar() {
  const path = useWorkspace((s) => s.path);
  const loading = useWorkspace((s) => s.loading);
  const loadDirectory = useFiles((s) => s.loadDirectory);

  useEffect(() => {
    if (!path) return;
    loadDirectory(path);
  }, [path, loadDirectory]);

  const startCreateFile = useEntryInput((s) => s.startCreateFile);
  const startCreateFolder = useEntryInput((s) => s.startCreateFolder);

  // Dropping onto empty space below the tree (rather than onto a specific
  // item) moves the dragged entry to the workspace root.
  const rootDropRef = useRef<HTMLDivElement>(null);
  const {
    drop: dropOnRoot,
    isOver: isRootOver,
    canDrop: canDropOnRoot,
  } = useFileTreeDrop(path ?? '');
  dropOnRoot(rootDropRef);

  const hoverTargetPath = useDragHoverStore((s) => s.hoverTargetPath);
  const isDropDestination = hoverTargetPath === path;

  if (loading) {
    return null;
  }

  if (!path) {
    return <div>No workspace open</div>;
  }

  return (
    <>
      <FileTreeDragLayer />
      <SidebarHeader className='px-4 py-2 text-xs font-medium text-muted-foreground'>
        <div className='flex items-center justify-between'>
          <p>Explorer</p>
          <div className='flex items-center'>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button variant='ghost' size='icon-sm'>
                    <Plus />
                  </Button>
                }
              />
              <DropdownMenuContent>
                {Object.values(FILE_TYPE_PRESETS).map(
                  (value: FileTypePreset) => {
                    const Icon = getFileIcon(value.extension);
                    return (
                      <DropdownMenuItem
                        key={value.id}
                        onClick={() => startCreateFile(path, value)}
                      >
                        <Icon />
                        {value.label}
                      </DropdownMenuItem>
                    );
                  },
                )}
                <DropdownMenuItem onClick={() => startCreateFolder(path)}>
                  {(() => {
                    const Icon = getFolderIcon();
                    return <Icon />;
                  })()}
                  Folder
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => startCreateFile(path)}>
                  {(() => {
                    const Icon = getFileIcon('');
                    return <Icon />;
                  })()}
                  File
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <ContextMenu>
          <ContextMenuTrigger
            render={
              <SidebarGroup
                ref={rootDropRef}
                className={cn(
                  'h-full py-0',
                  (isDropDestination || (isRootOver && canDropOnRoot)) && 'bg-accent/30',
                )}
              >
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
