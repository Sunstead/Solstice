import { ChevronRight, File, Folder } from 'lucide-react';
import { useFiles, FileTreeNode, selectChildren } from '@/hooks/use-files';
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
import { cn } from '@/lib/utils';

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

  const children = selectChildren(entries, node.path);

  if (!node.is_dir) {
    return (
      <SidebarMenuButton className='data-[active=true]:bg-transparent w-full max-w-full truncate'>
        <File />
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
              <Folder className='size-4 min-w-4' />
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
