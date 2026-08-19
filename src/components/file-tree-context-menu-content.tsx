import { FileTreeNode, useFiles } from '@/hooks/use-files';
import { useEntryInput, FILE_TYPE_PRESETS } from '@/lib/stores/entry-input';
import { useFileActionDialog } from '@/lib/stores/file-action-dialog';
import {
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
} from './ui/context-menu';
import { FolderInput, PencilLine, Trash } from 'lucide-react';

/**
 * Just the menu items — the delete/move dialogs themselves live in the
 * single global `FileActionDialogs` instance, not here. Rendering a portal
 * Dialog as a child of `<ContextMenuContent>` would let right-clicks inside
 * it bubble back up through React's tree and reopen this menu; see
 * `FileActionDialogs` for the full explanation.
 */
export function FileTreeItemContextMenuContent({
  node,
  renameEnabled = true,
  deleteEnabled = true,
  moveEnabled = true,
}: {
  node: FileTreeNode;
  renameEnabled?: boolean;
  deleteEnabled?: boolean;
  moveEnabled?: boolean;
}) {
  const expandDirectory = useFiles((s) => s.expandDirectory);
  const startCreateFile = useEntryInput((s) => s.startCreateFile);
  const startCreateFolder = useEntryInput((s) => s.startCreateFolder);
  const startRename = useEntryInput((s) => s.startRename);
  const requestDelete = useFileActionDialog((s) => s.requestDelete);
  const requestMove = useFileActionDialog((s) => s.requestMove);

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
        onClick={() => {
          setTimeout(() => startRename(node), 0);
        }}
        disabled={!renameEnabled}
      >
        <PencilLine />
        Rename
      </ContextMenuItem>
      <ContextMenuItem
        onClick={() => {
          setTimeout(() => requestMove(node), 0);
        }}
        disabled={!moveEnabled}
      >
        <FolderInput />
        Move to...
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem
        variant='destructive'
        onClick={() => {
          setTimeout(() => requestDelete(node), 0);
        }}
        disabled={!deleteEnabled}
      >
        <Trash />
        Delete
      </ContextMenuItem>
    </ContextMenuContent>
  );
}
