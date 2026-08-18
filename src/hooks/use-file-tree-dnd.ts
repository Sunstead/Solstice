import { useEffect, useRef } from 'react';
import { useDrag, useDrop } from 'react-dnd';
import { getEmptyImage } from 'react-dnd-html5-backend';
import { canMove, type MovableEntry } from '@/lib/file-operations';
import { fileOperations } from '@/lib/file-operations';
import { useDragHoverStore } from '@/hooks/use-drag-hover';

export const FILE_TREE_ITEM_TYPE = 'file-tree-node';

interface DragCollectedProps {
  isDragging: boolean;
}

interface DropCollectedProps {
  isOver: boolean;
  canDrop: boolean;
}

/** Makes a file tree node (file or folder) a drag source. */
export function useFileTreeDrag(node: MovableEntry) {
  const [{ isDragging }, drag, preview] = useDrag<MovableEntry, unknown, DragCollectedProps>(
    () => ({
      type: FILE_TREE_ITEM_TYPE,
      item: { path: node.path, name: node.name, is_dir: node.is_dir },
      collect: (monitor) => ({
        isDragging: monitor.isDragging(),
      }),
    }),
    [node.path, node.name, node.is_dir],
  );

  // The HTML5 backend otherwise renders a screenshot of the dragged DOM node
  // (the dimmed-button look). Swap it for an empty image so our custom
  // FileTreeDragLayer preview is the only thing shown while dragging.
  useEffect(() => {
    preview(getEmptyImage(), { captureDraggingState: true });
  }, [preview]);

  return { drag, isDragging };
}

interface UseFileTreeDropOptions {
  /** Called when a valid drag hovers this target for a bit, e.g. to expand a collapsed folder. */
  autoExpand?: () => void;
  /** Skip the auto-expand timer when the target is already expanded. */
  expanded?: boolean;
}

/**
 * Turns an element into a drop target that moves the dragged entry into
 * `targetParentPath`. Pass a folder's own path to drop *into* it, or a
 * file's parent path to drop the dragged entry alongside it.
 */
export function useFileTreeDrop(
  targetParentPath: string,
  options: UseFileTreeDropOptions = {},
) {
  const { autoExpand, expanded } = options;

  const setHoverTarget = useDragHoverStore((s) => s.setHoverTarget);
  const clearHoverTarget = useDragHoverStore((s) => s.clearHoverTarget);

  const [{ isOver, canDrop }, drop] = useDrop<MovableEntry, unknown, DropCollectedProps>(
    () => ({
      accept: FILE_TREE_ITEM_TYPE,
      canDrop: (item) => canMove(item, targetParentPath),
      drop: (item, monitor) => {
        // Drop targets nest (a file's row sits inside its folder's children
        // container, which sits inside the root). react-dnd calls every
        // matching target's `drop` on the way out from innermost to
        // outermost, not just the one under the cursor. Without this guard,
        // a drop that's a no-op at the innermost level (dropping a file back
        // into the folder it's already in) falls through to an ancestor
        // target whose path *does* differ, moving the entry up a level
        // instead of leaving it in place.
        if (monitor.didDrop()) return;
        fileOperations.move(item, targetParentPath);
      },
      collect: (monitor) => ({
        isOver: monitor.isOver({ shallow: true }),
        canDrop: monitor.canDrop(),
      }),
    }),
    [targetParentPath],
  );

  // Broadcast "this path is the current drop destination" so the owning
  // folder's row and children container can highlight themselves even when
  // the pointer is actually over a file inside it, not the folder itself.
  useEffect(() => {
    if (isOver && canDrop) {
      setHoverTarget(targetParentPath);
      return () => clearHoverTarget(targetParentPath);
    }
  }, [isOver, canDrop, targetParentPath, setHoverTarget, clearHoverTarget]);

  // Mirror most desktop file explorers: hovering a drag over a collapsed
  // folder for a moment expands it so you can drop deeper without letting go.
  const expandTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  useEffect(() => {
    if (!autoExpand || expanded || !isOver || !canDrop) return;

    expandTimeoutRef.current = setTimeout(autoExpand, 600);
    return () => clearTimeout(expandTimeoutRef.current);
  }, [autoExpand, expanded, isOver, canDrop]);

  return { drop, isOver, canDrop };
}