import { ChevronRight } from 'lucide-react';
import { useFiles, FileTreeNode, selectChildren } from '@/hooks/use-files';
import { useLayout } from '@/hooks/use-layout';
import {
  useEntryInput,
  FILE_TYPE_PRESETS,
  stripPresetExtension,
} from '@/lib/stores/entry-input';
import { EntryInput } from './entry-input';
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
import { useEffect } from 'react';
import { registerCommand, unregisterCommand } from '@/lib/commands';
import { FileTreeItemContextMenuContent } from './file-tree-context-menu-content';

type FileTreeProps = {
  path: string;
};

export function FileTree({ path }: FileTreeProps) {
  const entries = useFiles((s) => s.entries);
  const children = selectChildren(entries, path);
  const operation = useEntryInput((s) => s.operation);
  const startCreateFile = useEntryInput((s) => s.startCreateFile);
  const cancel = useEntryInput((s) => s.cancel);

  useEffect(() => {
    // "New note" command always uses the markdown preset — extension is autofilled.
    registerCommand('file.new_note', () =>
      startCreateFile(path, FILE_TYPE_PRESETS.markdown),
    );
    return () => unregisterCommand('file.new_note');
  }, [path, startCreateFile]);

  const showCreateInput =
    operation?.mode === 'create' && operation.parentPath === path;

  return (
    <>
      {children.map((child) => (
        <FileTreeItem key={child.path} node={child} />
      ))}
      {showCreateInput && (
        <EntryInput
          kind={operation.kind}
          onSubmit={(finalName) => {
            console.log(
              operation.kind.type === 'folder'
                ? 'Creating folder: '
                : 'Creating file: ',
              path,
              finalName,
            );
            cancel();
          }}
          onCancel={cancel}
        />
      )}
    </>
  );
}

function FileTreeItem({ node }: { node: FileTreeNode }) {
  const expandDirectory = useFiles((s) => s.expandDirectory);
  const collapseDirectory = useFiles((s) => s.collapseDirectory);
  const entries = useFiles((s) => s.entries);
  const openFile = useLayout((s) => s.openFile);
  const activeTabId = useLayout((s) => s.activeTabId);
  const operation = useEntryInput((s) => s.operation);
  const cancel = useEntryInput((s) => s.cancel);

  const children = selectChildren(entries, node.path);

  const FolderIcon = getFolderIcon(node.expanded);
  const FileIcon = getFileIcon(getFileExtension(node.name));

  const isRenaming =
    operation?.mode === 'rename' && operation.path === node.path;

  const showCreateInput =
    node.is_dir &&
    operation?.mode === 'create' &&
    operation.parentPath === node.path;

  if (!node.is_dir) {
    if (isRenaming) {
      return (
        <EntryInput
          kind={operation.kind}
          initialValue={operation.initialName}
          onSubmit={(finalName) => {
            console.log('Renaming: ', node.path, '->', finalName);
            cancel();
          }}
          onCancel={cancel}
        />
      );
    }

    return (
      <ContextMenu>
        <ContextMenuTrigger
          render={
            <SidebarMenuButton
              isActive={activeTabId === node.path}
              className='data-active:font-normal w-full max-w-full truncate pl-8'
              onClick={() => openFile(node.path, node.name)}
            >
              <FileIcon />
              <FormattedFileName name={node.name} />
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
        {isRenaming ? (
          <EntryInput
            kind={operation.kind}
            initialValue={operation.initialName}
            onSubmit={(finalName) => {
              console.log('Renaming: ', node.path, '->', finalName);
              cancel();
            }}
            onCancel={cancel}
            expanded={node.expanded}
          />
        ) : (
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
                      <FormattedFileName name={node.name} />
                    </SidebarMenuButton>
                  }
                />
              }
            />
            <FileTreeItemContextMenuContent node={node} />
          </ContextMenu>
        )}

        <CollapsibleContent>
          <SidebarMenuSub className='pr-0 pl-0.5 mr-0 ml-3.5 gap-0 py-0'>
            {children.map((child) => (
              <FileTreeItem key={child.path} node={child} />
            ))}
            {showCreateInput && (
              <EntryInput
                kind={operation.kind}
                onSubmit={(finalName) => {
                  console.log(
                    operation.kind.type === 'folder'
                      ? 'Creating folder: '
                      : 'Creating file: ',
                    node.path,
                    finalName,
                  );
                  cancel();
                }}
                onCancel={cancel}
              />
            )}
          </SidebarMenuSub>
        </CollapsibleContent>
      </Collapsible>
    </SidebarMenuItem>
  );
}

function FormattedFileName({ name }: { name: string }) {
  return (
    <span className='text-nowrap w-full truncate'>
      {stripPresetExtension(name).name}
    </span>
  );
}
