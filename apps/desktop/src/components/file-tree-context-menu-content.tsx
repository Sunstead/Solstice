import { FileTreeNode } from '@/hooks/use-files';
import { useEntryMenuItems } from '@/lib/entry-menu-items';
import { EntryMenuItems } from './entry-menu-items';
import {
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from '@sunstead/ui/components/context-menu';

const components = {
  Item: ContextMenuItem,
  Separator: ContextMenuSeparator,
  Sub: ContextMenuSub,
  SubTrigger: ContextMenuSubTrigger,
  SubContent: ContextMenuSubContent,
};

/**
 * Just the menu items — the delete/move dialogs themselves live in the
 * single global `FileActionDialogs` instance, not here. Rendering a portal
 * Dialog as a child of `<ContextMenuContent>` would let right-clicks inside
 * it bubble back up through React's tree and reopen this menu; see
 * `FileActionDialogs` for the full explanation.
 */
export function FileTreeItemContextMenuContent({
  node,
  surface = 'tree',
  renameEnabled = true,
  deleteEnabled = true,
  moveEnabled = true,
}: {
  node: FileTreeNode;
  /** `'root'` is the sidebar's background: the workspace folder itself. */
  surface?: 'tree' | 'root';
  renameEnabled?: boolean;
  deleteEnabled?: boolean;
  moveEnabled?: boolean;
}) {
  const items = useEntryMenuItems(node, {
    surface,
    renameEnabled,
    deleteEnabled,
    moveEnabled,
  });

  return (
    <ContextMenuContent className='min-w-52'>
      <EntryMenuItems items={items} components={components} />
    </ContextMenuContent>
  );
}
