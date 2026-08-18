import { useDragLayer, type XYCoord } from 'react-dnd';
import { FILE_TREE_ITEM_TYPE } from '@/hooks/use-file-tree-dnd';
import type { MovableEntry } from '@/lib/file-operations';
import { getFileIcon, getFolderIcon } from '@/assets/icons';
import { getFileExtension } from '@/lib/utils';

function previewStyle(offset: XYCoord | null): React.CSSProperties {
  if (!offset) return { display: 'none' };
  // Offset slightly so the preview sits beside the cursor instead of under it.
  return { transform: `translate(${offset.x + 2}px, ${offset.y + 2}px)` };
}

/**
 * Renders the floating "chip" that follows the cursor while a file tree
 * node is being dragged, replacing the native HTML5 drag screenshot (which
 * useFileTreeDrag disables via getEmptyImage). Mount this once, anywhere
 * inside the same DndProvider as the file tree — it renders nothing when
 * no drag is in progress.
 */
export function FileTreeDragLayer() {
  const { item, itemType, isDragging, clientOffset } = useDragLayer((monitor) => ({
    item: monitor.getItem() as MovableEntry | null,
    itemType: monitor.getItemType(),
    isDragging: monitor.isDragging(),
    clientOffset: monitor.getClientOffset(),
  }));

  if (!isDragging || itemType !== FILE_TREE_ITEM_TYPE || !item) {
    return null;
  }

  const Icon = item.is_dir
    ? getFolderIcon(false)
    : getFileIcon(getFileExtension(item.name));

  return (
    <div className='pointer-events-none fixed inset-0 z-50 overflow-hidden'>
      <div
        className='absolute top-0 left-0 flex max-w-56 items-center gap-1.5 rounded-md border bg-popover px-2 py-1 text-sm text-popover-foreground shadow-lg'
        style={previewStyle(clientOffset)}
      >
        <Icon className='size-4 min-w-4 shrink-0' />
        <span className='truncate'>{item.name}</span>
      </div>
    </div>
  );
}