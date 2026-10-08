import { useRef, type ComponentType } from 'react';
import { useWorkspace } from '@/hooks/use-workspace';
import {
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
} from '@sunstead/ui/components/resizable-sidebar';
import { FileTree } from './file-tree';
import { ContextMenu, ContextMenuTrigger } from '@sunstead/ui/components/context-menu';
import { FileTreeItemContextMenuContent } from './file-tree-context-menu-content';
import { FileActionDialogs } from './file-action-dialogs';
import { FileTreeDragLayer } from './file-tree-drag-layer';
import { useFileTreeDrop } from '@/hooks/use-file-tree-dnd';
import { cn } from '@/lib/utils';
import { Button } from '@sunstead/ui/components/button';
import { Plus } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@sunstead/ui/components/dropdown-menu';
import {
  FILE_TYPE_PRESETS,
  FileTypePreset,
  useEntryInput,
} from '@/lib/stores/entry-input';
import { getFileIcon, getFolderIcon } from '@/assets/icons';
import { useDragHoverStore } from '@/hooks/use-drag-hover';

export type CreateAction = {
  id: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  run: () => void;
};

/** What can be made at the workspace's root: each creatable type, a folder, a file. */
export function useCreateActions(path: string | null): CreateAction[] {
  const startCreateFile = useEntryInput((s) => s.startCreateFile);
  const startCreateFolder = useEntryInput((s) => s.startCreateFolder);
  if (!path) return [];
  return [
    ...Object.values(FILE_TYPE_PRESETS)
      .filter((p) => p.creatable)
      .map((preset: FileTypePreset) => ({
        id: preset.id,
        label: preset.label,
        icon: getFileIcon(preset.extension),
        run: () => startCreateFile(path, preset),
      })),
    { id: 'folder', label: 'Folder', icon: getFolderIcon(), run: () => startCreateFolder(path) },
    { id: 'file', label: 'File', icon: getFileIcon(''), run: () => startCreateFile(path) },
  ];
}

export function ExplorerSidebar() {
  const path = useWorkspace((s) => s.path);
  const loading = useWorkspace((s) => s.loading);
  const create = useCreateActions(path);

  if (loading) {
    return null;
  }

  if (!path) {
    return <SidebarContent>No workspace open</SidebarContent>;
  }

  return (
    <>
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
              <DropdownMenuContent finalFocus={false}>
                {create.map((action) => (
                  <DropdownMenuItem key={action.id} onClick={action.run}>
                    <action.icon />
                    {action.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </SidebarHeader>
      <ExplorerTree path={path} />
    </>
  );
}

/**
 * The workspace's file tree, with the menu for its empty space and the
 * dialogs its rows open: the sidebar's body, and the phone's Files page.
 */
export function ExplorerTree({ path }: { path: string }) {
  // Dropping onto empty space below the tree (rather than onto a specific
  // item) moves the dragged entry to the workspace root.
  const rootDropRef = useRef<HTMLDivElement>(null);
  const {
    drop: dropOnRoot,
    isOver: isRootOver,
    canDrop: canDropOnRoot,
  } = useFileTreeDrop(path);
  dropOnRoot(rootDropRef);

  const hoverTargetPath = useDragHoverStore((s) => s.hoverTargetPath);
  const isDropDestination = hoverTargetPath === path;

  return (
    <>
      <FileTreeDragLayer />
      <FileActionDialogs />
      <SidebarContent>
        <ContextMenu>
          <ContextMenuTrigger
            render={
              <SidebarGroup
                ref={rootDropRef}
                className={cn(
                  'h-full py-0',
                  (isDropDestination || (isRootOver && canDropOnRoot)) &&
                    'bg-accent/30',
                )}
              >
                <SidebarGroupContent className='max-w-(--sidebar-width) group-data-[phone=true]/files:max-w-none'>
                  <SidebarMenu className='max-w-(--sidebar-width) gap-0 group-data-[phone=true]/files:max-w-none'>
                    <FileTree path={path} />
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            }
          />
          <FileTreeItemContextMenuContent
            surface='root'
            renameEnabled={false}
            deleteEnabled={false}
            moveEnabled={false}
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
