import {
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuShortcut,
} from '@/components/ui/context-menu';
import type { CanvasColor, EdgeEnd } from '@/lib/canvas/types';
import { CanvasColorPicker } from './canvas-color-picker';

/**
 * The board's right-click menu.
 *
 * No `Dialog` is rendered in here, deliberately. The file-tree menu's comment
 * spells out why: a right-click inside portalled dialog content bubbles back
 * through React's tree and reopens the menu. The link and file dialogs live on
 * the board and are opened by these items setting state.
 */

/** Whether a checkbox reads on, off, or "some of the selection disagrees". */
export type TriState = 'on' | 'off' | 'mixed';

export interface CanvasContextMenuProps {
  /** Whether the click landed on something, which decides what is offered. */
  hasSelection: boolean;
  selectionColor?: CanvasColor;
  /** Present only when every id in the selection is an edge. */
  edgeEnds?: { from: TriState; to: TriState };
  /** Present only when the selection is exactly one group or one edge. */
  renameKind?: 'group' | 'edge';
  onNewText: () => void;
  onNewGroup: () => void;
  onNewFile: () => void;
  onNewLink: () => void;
  onSetColor: (color: CanvasColor | undefined) => void;
  onSetEdgeEnd: (end: 'from' | 'to', value: EdgeEnd) => void;
  onRename: () => void;
  onDelete: () => void;
  onBringToFront: () => void;
  onSendToBack: () => void;
  onZoomToFit: () => void;
  onZoomToSelection: () => void;
}

export function CanvasContextMenuContent({
  hasSelection,
  selectionColor,
  edgeEnds,
  renameKind,
  onNewText,
  onNewGroup,
  onNewFile,
  onNewLink,
  onSetColor,
  onSetEdgeEnd,
  onRename,
  onDelete,
  onBringToFront,
  onSendToBack,
  onZoomToFit,
  onZoomToSelection,
}: CanvasContextMenuProps) {
  return (
    <ContextMenuContent className='min-w-52'>
      {hasSelection ? (
        <>
          <CanvasColorPicker value={selectionColor} onPick={onSetColor} />
          {edgeEnds && (
            <>
              <ContextMenuSeparator />
              <ContextMenuGroup>
                <ContextMenuLabel>Arrowheads</ContextMenuLabel>
                <ContextMenuCheckboxItem
                  checked={edgeEnds.from === 'on'}
                  onCheckedChange={(checked) =>
                    onSetEdgeEnd('from', checked ? 'arrow' : 'none')
                  }
                >
                  Start
                </ContextMenuCheckboxItem>
                <ContextMenuCheckboxItem
                  checked={edgeEnds.to === 'on'}
                  onCheckedChange={(checked) =>
                    onSetEdgeEnd('to', checked ? 'arrow' : 'none')
                  }
                >
                  End
                </ContextMenuCheckboxItem>
              </ContextMenuGroup>
            </>
          )}
          {renameKind && (
            <>
              <ContextMenuSeparator />
              <ContextMenuItem onClick={onRename}>
                {renameKind === 'group' ? 'Rename group...' : 'Edit label...'}
              </ContextMenuItem>
            </>
          )}
          <ContextMenuSeparator />
          <ContextMenuItem onClick={onBringToFront}>
            Bring to front
          </ContextMenuItem>
          <ContextMenuItem onClick={onSendToBack}>Send to back</ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem onClick={onZoomToSelection}>
            Zoom to selection
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem variant='destructive' onClick={onDelete}>
            Delete
          </ContextMenuItem>
        </>
      ) : (
        <>
          <ContextMenuItem onClick={onNewText}>New card</ContextMenuItem>
          <ContextMenuItem onClick={onNewFile}>New file card...</ContextMenuItem>
          <ContextMenuItem onClick={onNewLink}>New link card...</ContextMenuItem>
          <ContextMenuItem onClick={onNewGroup}>New group</ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem onClick={onZoomToFit}>
            Zoom to fit
            <ContextMenuShortcut>0</ContextMenuShortcut>
          </ContextMenuItem>
        </>
      )}
    </ContextMenuContent>
  );
}
