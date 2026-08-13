import { FileTreeNode, useFiles } from '@/hooks/use-files';
import { useNewFileInput } from '@/lib/stores/new-file-input';
import {
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
} from './ui/context-menu';

export function FileTreeItemContextMenuContent({
  node,
}: {
  node: FileTreeNode;
}) {
  const expandDirectory = useFiles((s) => s.expandDirectory);
  const startNewFile = useNewFileInput((s) => s.startNewFile);

  const handleNewFile = () => {
    if (!node.expanded) {
      expandDirectory(node.path);
    }
    startNewFile(node.path);
  };

  return (
    <ContextMenuContent>
      {node.is_dir && (
        <>
          <ContextMenuItem onClick={handleNewFile}>New File</ContextMenuItem>
          <ContextMenuItem
            onClick={() => console.log('New folder in', node.path)}
          >
            New Folder
          </ContextMenuItem>
          <ContextMenuSeparator />
        </>
      )}
      <ContextMenuItem onClick={() => console.log('Rename', node.path)}>
        Rename
      </ContextMenuItem>
      <ContextMenuItem
        variant='destructive'
        onClick={() => console.log('Delete', node.path)}
      >
        Delete
      </ContextMenuItem>
    </ContextMenuContent>
  );
}
