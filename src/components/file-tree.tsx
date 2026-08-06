import { ChevronRight, File, Folder } from 'lucide-react';
import { useFiles, FileTreeNode, selectChildren } from '@/hooks/use-files';
import { useLayout } from '@/hooks/use-layout';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from './ui/collapsible';
import {
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
} from './ui/resizable-sidebar';
import { cn, getFileExtension } from '@/lib/utils';
import { getFileIcon, getFolderIcon } from '@/assets/icons';

type FileTreeProps = {
  path: string;
};

export function FileTree({ path }: FileTreeProps) {
  const entries = useFiles((s) => s.entries);
  const children = selectChildren(entries, path);

  return (
    <>
      {children.map((child) => (
        <FileTreeItem key={child.path} node={child} />
      ))}
    </>
  );
}

function FileTreeItem({ node }: { node: FileTreeNode }) {
  const expandDirectory = useFiles((s) => s.expandDirectory);
  const collapseDirectory = useFiles((s) => s.collapseDirectory);
  const entries = useFiles((s) => s.entries);
  const openFile = useLayout((s) => s.openFile);
  
  const activeTabId = useLayout((s) => s.activeTabId);

  const children = selectChildren(entries, node.path);

  const FolderIcon = getFolderIcon();
  const FileIcon = getFileIcon(getFileExtension(node.name));

  if (!node.is_dir) {
    return (
      <SidebarMenuButton
        isActive={activeTabId === node.path}
        className='data-active:font-normal w-full max-w-full truncate'
        onClick={() => openFile(node.path, node.name)}
      >
        <FileIcon />
        {/* <File /> */}
        <span className='text-nowrap w-full truncate'>{node.name}</span>
      </SidebarMenuButton>
    );
  }

  return (
    <SidebarMenuItem>
      <Collapsible
        open={node.expanded}
        onOpenChange={(open) => {
          if (open) {
            expandDirectory(node.path);
          } else {
            collapseDirectory(node.path);
          }
        }}
      >
        <CollapsibleTrigger
          render={
            <SidebarMenuButton>
              <ChevronRight
                className={cn(
                  'transition-transform',
                  node.expanded && 'rotate-90',
                )}
              />
              <FolderIcon className='size-4 min-w-4' />
              {/* <Folder className='size-4 min-w-4' /> */}
              <span className='text-nowrap truncate'>{node.name}</span>
            </SidebarMenuButton>
          }
        />

        <CollapsibleContent>
          <SidebarMenuSub className='pr-0 pl-1 mr-0 ml-3 gap-0 py-0'>
            {children.map((child) => (
              <FileTreeItem key={child.path} node={child} />
            ))}
          </SidebarMenuSub>
        </CollapsibleContent>
      </Collapsible>
    </SidebarMenuItem>
  );
}
