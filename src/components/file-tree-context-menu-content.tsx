import { FileTreeNode, useFiles } from '@/hooks/use-files';
import { useEntryInput, FILE_TYPE_PRESETS } from '@/lib/stores/entry-input';
import {
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
} from './ui/context-menu';

export function FileTreeItemContextMenuContent({
  node,
  renameEnabled = true,
  deleteEnabled = true,
}: {
  node: FileTreeNode;
  renameEnabled?: boolean;
  deleteEnabled?: boolean;
}) {
  const expandDirectory = useFiles((s) => s.expandDirectory);
  const startCreateFile = useEntryInput((s) => s.startCreateFile);
  const startCreateFolder = useEntryInput((s) => s.startCreateFolder);
  const startRename = useEntryInput((s) => s.startRename);

  const ensureExpanded = () => {
    if (!node.expanded) {
      expandDirectory(node.path);
    }
  };

  return (
    <ContextMenuContent>
      {node.is_dir && (
        <>
          {Object.values(FILE_TYPE_PRESETS).map((preset) => (
            <ContextMenuItem
              key={preset.id}
              onClick={() => {
                ensureExpanded();
                startCreateFile(node.path, preset);
              }}
            >
              New {preset.label}
            </ContextMenuItem>
          ))}
          <ContextMenuItem
            onClick={() => {
              ensureExpanded();
              startCreateFolder(node.path);
            }}
          >
            New Folder
          </ContextMenuItem>
          <ContextMenuItem
            onClick={() => {
              ensureExpanded();
              startCreateFile(node.path);
            }}
          >
            New File
          </ContextMenuItem>
          <ContextMenuSeparator />
        </>
      )}
      <ContextMenuItem
        onClick={() => startRename(node)}
        disabled={!renameEnabled}
      >
        Rename
      </ContextMenuItem>
      <ContextMenuItem
        variant='destructive'
        onClick={() => console.log('Delete', node.path)}
        disabled={!deleteEnabled}
      >
        Delete
      </ContextMenuItem>
    </ContextMenuContent>
  );
}
