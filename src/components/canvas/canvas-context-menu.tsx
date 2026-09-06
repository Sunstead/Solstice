import { Fragment } from 'react';

import {
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
} from '@/components/ui/context-menu';
import type { CanvasColor, EdgeEnd } from '@/lib/canvas/types';
import { CanvasColorPicker } from './canvas-color-picker';
import {
  Group,
  LayersArrowDown,
  LayersArrowUp,
  Link2,
  Maximize2,
  MoveLeft,
  MoveRight,
  PencilLine,
  SquareChartGantt,
  SquarePlus,
  Trash,
} from 'lucide-react';

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
  /*
   * What this menu *is*, so React rebuilds it when it becomes a different one.
   *
   * Both branches are flat lists of `ContextMenuItem`s, so without a key React
   * reconciles them slot by slot and relabels the node at each position rather
   * than replacing it. That carries Base UI's per-item state across, and in
   * WebKit the old label could stay on screen: the popup paints over a
   * `backdrop-filter` layer, which an in-place text change did not always
   * invalidate.
   */
  const shape = [
    hasSelection ? 'selection' : 'board',
    edgeEnds ? 'edges' : '',
    renameKind ?? '',
  ].join('/');

  return (
    <ContextMenuContent className='min-w-52'>
      <Fragment key={shape}>
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
                    <MoveLeft />
                    Start
                  </ContextMenuCheckboxItem>
                  <ContextMenuCheckboxItem
                    checked={edgeEnds.to === 'on'}
                    onCheckedChange={(checked) =>
                      onSetEdgeEnd('to', checked ? 'arrow' : 'none')
                    }
                  >
                    <MoveRight />
                    End
                  </ContextMenuCheckboxItem>
                </ContextMenuGroup>
              </>
            )}
            {renameKind && (
              <>
                <ContextMenuSeparator />
                <ContextMenuItem onClick={onRename}>
                  <PencilLine />
                  {renameKind === 'group' ? 'Rename group...' : 'Edit label...'}
                </ContextMenuItem>
              </>
            )}
            <ContextMenuSeparator />
            <ContextMenuItem onClick={onBringToFront}>
              <LayersArrowUp />
              Bring to front
            </ContextMenuItem>
            <ContextMenuItem onClick={onSendToBack}>
              <LayersArrowDown />
              Send to back
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem onClick={onZoomToSelection}>
              <Maximize2 />
              Zoom to selection
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem variant='destructive' onClick={onDelete}>
              <Trash />
              Delete
            </ContextMenuItem>
          </>
        ) : (
          <>
            <ContextMenuItem onClick={onNewText}>
              <SquarePlus />
              New card</ContextMenuItem>
            <ContextMenuItem onClick={onNewFile}>
              <SquareChartGantt />
              New file card...
            </ContextMenuItem>
            <ContextMenuItem onClick={onNewLink}>
              <Link2 />
              New link card...
            </ContextMenuItem>
            <ContextMenuItem onClick={onNewGroup}>
              <Group />
              New group</ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem onClick={onZoomToFit}>
              <Maximize2 />
              Zoom to fit
            </ContextMenuItem>
          </>
        )}
      </Fragment>
    </ContextMenuContent>
  );
}
