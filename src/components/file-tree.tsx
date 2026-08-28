import { ChevronRight } from 'lucide-react';
import { useFiles, FileTreeNode, useDirectoryChildren } from '@/hooks/use-files';
import { useLayout } from '@/hooks/use-layout';
import {
  useEntryInput,
  FILE_TYPE_PRESETS,
  stripPresetExtension,
} from '@/lib/stores/entry-input';
import { fileOperations, parentOf } from '@/lib/file-operations';
import { useFileTreeDrag, useFileTreeDrop } from '@/hooks/use-file-tree-dnd';
import { useDragHoverStore } from '@/hooks/use-drag-hover';
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
import { useEffect, useRef, type KeyboardEvent } from 'react';
import { registerCommand, unregisterCommand } from '@/lib/commands';
import { useIsMac } from '@/hooks/use-platform';
import { FileTreeItemContextMenuContent } from './file-tree-context-menu-content';
import { useFileActionDialog } from '@/lib/stores/file-action-dialog';
import { useSetting } from '@/lib/settings/store';

type FileTreeProps = {
  path: string;
};

export function FileTree({ path }: FileTreeProps) {
  const children = useDirectoryChildren(path);
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
            if (operation.kind.type === 'folder') {
              fileOperations.createFolder(path, finalName);
            } else {
              fileOperations.createFile(path, finalName);
            }
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
  const openFile = useLayout((s) => s.openFile);
  const activeTabId = useLayout((s) => s.activeTabId);
  const operation = useEntryInput((s) => s.operation);
  const cancel = useEntryInput((s) => s.cancel);
  const isMac = useIsMac();
  const requestDelete = useFileActionDialog((s) => s.requestDelete);

  const children = useDirectoryChildren(node.path);

  const FolderIcon = getFolderIcon(node.expanded);
  const FileIcon = getFileIcon(getFileExtension(node.name));

  const isRenaming =
    operation?.mode === 'rename' && operation.path === node.path;

  const showCreateInput =
    node.is_dir &&
    operation?.mode === 'create' &&
    operation.parentPath === node.path;

  const handleDeleteKeyDown = (event: KeyboardEvent) => {
    const isDeleteKey =
      event.key === 'Delete' || (isMac && event.key === 'Backspace');
    if (!isDeleteKey) return;

    event.preventDefault();
    requestDelete(node);
  };

  // Every node is a drag source. Its drop target depends on its type:
  // dropping onto a folder moves the dragged entry inside it, while
  // dropping onto a file moves the entry alongside it (into the same
  // directory), matching how most desktop file explorers behave.
  const nodeRef = useRef<HTMLButtonElement>(null);
  const { drag, isDragging } = useFileTreeDrag(node);
  const dropTargetPath = node.is_dir ? node.path : parentOf(node.path);
  const { drop } = useFileTreeDrop(dropTargetPath, {
    autoExpand: node.is_dir ? () => expandDirectory(node.path) : undefined,
    expanded: node.expanded,
  });
  drag(drop(nodeRef));

  // Folders get a second, independent drop target scoped to their contents
  // area, so dropping on empty space inside the folder (not on a specific
  // child) still resolves to this folder instead of bubbling up to an
  // ancestor. This is deliberately its own `useDrop` instance rather than
  // reusing the row's connector: react-dnd prioritizes nested drop targets
  // over their ancestors via native DOM containment (`isOver({shallow})`),
  // and that only works cleanly when each DOM region maps to exactly one
  // handler. Sharing a single handler across two disjoint elements (the row
  // and this container) broke that — a nested folder's own row would lose
  // priority to this container whenever it sat inside it.
  const childrenDropRef = useRef<HTMLDivElement>(null);
  const { drop: dropOnChildren } = useFileTreeDrop(node.path);
  if (node.is_dir) {
    dropOnChildren(childrenDropRef);
  }

  // Only folders highlight, and only as the *current drop destination* —
  // whether the pointer is directly over the folder's own row, or over one
  // of its files (whose drop zone resolves to this same folder path).
  // Files themselves never show a highlight; hovering one just indicates
  // where inside the folder the drop would land.
  const hoverTargetPath = useDragHoverStore((s) => s.hoverTargetPath);
  const isDropDestination = node.is_dir && hoverTargetPath === node.path;

  const dropHighlightClassName = cn(
    isDragging && 'opacity-50',
    isDropDestination &&
      'bg-accent/50 outline outline-1 -outline-offset-1 outline-accent-foreground/40',
  );

  // A softer wash across the whole "contents" area, so it's clear the
  // folder as a whole — not just the row — is where the drop will land.
  const childrenHighlightClassName = cn(
    isDropDestination && 'bg-accent/20 rounded-sm',
  );

  if (!node.is_dir) {
    if (isRenaming) {
      return (
        <EntryInput
          kind={operation.kind}
          initialValue={operation.initialName}
          onSubmit={(finalName) => {
            fileOperations.rename(node.path, finalName);
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
              ref={nodeRef}
              isActive={activeTabId === node.path}
              className={cn(
                'data-active:font-normal w-full max-w-full truncate pl-8',
                dropHighlightClassName,
              )}
              onClick={() => openFile(node.path, node.name)}
              onKeyDown={handleDeleteKeyDown}
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
        open={node.expanded && node.childrenLoaded}
        className={childrenHighlightClassName}
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
              fileOperations.rename(node.path, finalName);
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
                    <SidebarMenuButton
                      ref={nodeRef}
                      className={dropHighlightClassName}
                      onKeyDown={handleDeleteKeyDown}
                    >
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

        <CollapsibleContent ref={childrenDropRef}>
          <SidebarMenuSub className='pr-0 pl-0.5 mr-0 ml-3.5 gap-0 py-0'>
            {children.map((child) => (
              <FileTreeItem key={child.path} node={child} />
            ))}
            {showCreateInput && (
              <EntryInput
                kind={operation.kind}
                onSubmit={(finalName) => {
                  if (operation.kind.type === 'folder') {
                    fileOperations.createFolder(node.path, finalName);
                  } else {
                    fileOperations.createFile(node.path, finalName);
                  }
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

export function FormattedFileName({ name }: { name: string }) {
  const showExtensions = useSetting('explorer.showFileExtensions');

  return (
    <span className='text-nowrap w-full truncate'>
      {showExtensions ? name : stripPresetExtension(name).name}
    </span>
  );
}
