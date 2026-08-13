import { ChevronRight } from 'lucide-react';
import { useFiles, FileTreeNode, selectChildren } from '@/hooks/use-files';
import { useLayout } from '@/hooks/use-layout';
import { useNewFileInput } from '@/lib/stores/new-file-input';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from './ui/collapsible';
import { ContextMenu, ContextMenuTrigger } from './ui/context-menu';
import {
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
} from './ui/resizable-sidebar';
import { cn, getFileExtension } from '@/lib/utils';
import { getFileIcon, getFolderIcon } from '@/assets/icons';
import { useEffect, useState } from 'react';
import { InputGroup, InputGroupAddon, InputGroupInput } from './ui/input-group';
import { registerCommand, unregisterCommand } from '@/lib/commands';
import { FileTreeItemContextMenuContent } from './file-tree-context-menu-content';

type FileTreeProps = {
  path: string;
};

export function FileTree({ path }: FileTreeProps) {
  const entries = useFiles((s) => s.entries);
  const children = selectChildren(entries, path);
  const newFileParentPath = useNewFileInput((s) => s.parentPath);
  const startNewFile = useNewFileInput((s) => s.startNewFile);

  useEffect(() => {
    registerCommand('file.new_note', () => startNewFile(path));
    return () => unregisterCommand('file.new_note');
  }, [path, startNewFile]);

  return (
    <>
      {children.map((child) => (
        <FileTreeItem key={child.path} node={child} />
      ))}
      {newFileParentPath === path && <NewFileInput parentPath={path} />}
    </>
  );
}

function FileTreeItem({ node }: { node: FileTreeNode }) {
  const expandDirectory = useFiles((s) => s.expandDirectory);
  const collapseDirectory = useFiles((s) => s.collapseDirectory);
  const entries = useFiles((s) => s.entries);
  const openFile = useLayout((s) => s.openFile);
  const activeTabId = useLayout((s) => s.activeTabId);
  const newFileParentPath = useNewFileInput((s) => s.parentPath);

  const children = selectChildren(entries, node.path);

  const FolderIcon = getFolderIcon();
  const FileIcon = getFileIcon(getFileExtension(node.name));

  if (!node.is_dir) {
    return (
      <ContextMenu>
        <ContextMenuTrigger
          render={
            <SidebarMenuButton
              isActive={activeTabId === node.path}
              className='data-active:font-normal w-full max-w-full truncate'
              onClick={() => openFile(node.path, node.name)}
            >
              <FileIcon />
              <span className='text-nowrap w-full truncate'>{node.name}</span>
            </SidebarMenuButton>
          }
        />
        <FileTreeItemContextMenuContent node={node} />
      </ContextMenu>
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
        <ContextMenu>
          <ContextMenuTrigger
            render={
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
                    <span className='text-nowrap truncate'>{node.name}</span>
                  </SidebarMenuButton>
                }
              />
            }
          />
          <FileTreeItemContextMenuContent node={node} />
        </ContextMenu>

        <CollapsibleContent>
          <SidebarMenuSub className='pr-0 pl-1 mr-0 ml-3 gap-0 py-0'>
            {children.map((child) => (
              <FileTreeItem key={child.path} node={child} />
            ))}
            {newFileParentPath === node.path && (
              <NewFileInput parentPath={node.path} />
            )}
          </SidebarMenuSub>
        </CollapsibleContent>
      </Collapsible>
    </SidebarMenuItem>
  );
}

function NewFileInput({ parentPath }: { parentPath: string }) {
  const [name, setName] = useState<string>('');
  const cancelNewFile = useNewFileInput((s) => s.cancelNewFile);
  const fileExt = 'md';
  const Icon = getFileIcon(fileExt);

  const submit = () => {
    console.log('Creating file: ', parentPath, name);
    cancelNewFile();
  };

  return (
    <InputGroup
      className='h-8'
      onBlur={cancelNewFile}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          submit();
        } else if (e.key === "Escape") {
          cancelNewFile();
        }
      }}
    >
      <InputGroupInput
        value={name}
        onChange={(e) => setName(e.target.value)}
        className='pl-2! h-8'
        autoFocus
      />
      <InputGroupAddon>
        <Icon />
      </InputGroupAddon>
    </InputGroup>
  );
}
