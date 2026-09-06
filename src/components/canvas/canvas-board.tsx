import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Group,
  Link2,
  Map as MapIcon,
  Maximize2,
  Minus,
  Plus,
  SquareChartGantt,
  SquarePlus,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  ViewerToolbar,
  ViewerToolbarReadout,
  ViewerToolbarSeparator,
} from '@/components/viewer/viewer-toolbar';
import {
  ContextMenu,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import {
  addNode,
  boundsOf,
  boundsOfIds,
  bringToFront,
  createNode,
  removeSelection,
  sendToBack,
  setColor,
  setEdgeEnds,
  setLabel,
} from '@/lib/canvas/doc';
import { snapStepForScale, snapValue } from '@/lib/canvas/grid';
import { useCanvasGestures } from '@/lib/canvas/use-canvas-gestures';
import {
  DEFAULT_NODE_SIZE,
  type CanvasColor,
  type CanvasNodeType,
  type EdgeEnd,
  type Point,
} from '@/lib/canvas/types';
import { useCanvasCommands } from '@/lib/canvas/use-canvas-commands';
import { useCanvasStore, useCanvasStoreApi } from '@/lib/canvas/use-canvas-store';
import {
  fitTo,
  toCanvas,
  MOUSE_STEP,
  stepScale,
  TOUCHPAD_DELTA,
  TOUCHPAD_STEP,
  zoomAbout,
} from '@/lib/canvas/viewport';
import { warmStaticRenderer } from '@/lib/editor/static-markdown';
import { getSetting, setSetting, useSetting } from '@/lib/settings/store';
import { CanvasContextMenuContent, type TriState } from './canvas-context-menu';
import { fromEndOf, toEndOf } from '@/lib/canvas/edge-geometry';
import { CanvasFilePicker } from './canvas-file-picker';
import { CanvasLinkDialog } from './canvas-link-dialog';
import { CanvasMinimap } from './canvas-minimap';
import {
  CanvasRenameDialog,
  type RenameKind,
} from './canvas-rename-dialog';
import { CanvasOverlays } from './canvas-overlays';
import { CanvasSurface } from './canvas-surface';

/**
 * The board as an editable surface: the viewport, the toolbar, the context
 * menu and the dialogs that create cards.
 *
 * Rendering goes through `CanvasSurface`, which knows none of this and is what
 * the embedded preview renders too. Pointer and keyboard handling live in
 * `useCanvasGestures`, and the transitions they drive are pure and live in
 * `interaction.ts`.
 */
export function CanvasBoard({ path }: { path: string }) {
  const store = useCanvasStoreApi();
  const containerRef = useRef<HTMLDivElement>(null);

  // Building the headless markdown renderer is async, so start it with the tab
  // rather than with the first card that needs it.
  useEffect(() => warmStaticRenderer(), []);

  const doc = useCanvasStore((state) => state.doc);
  const view = useCanvasStore((state) => state.view);
  const pane = useCanvasStore((state) => state.pane);
  const selection = useCanvasStore((state) => state.selection);
  const editingNodeId = useCanvasStore((state) => state.editingNodeId);
  const interaction = useCanvasStore((state) => state.interaction);

  // Hidden while one of its ends is being dragged; the overlay draws the live
  // draft in its place.
  const hiddenEdgeId =
    interaction.kind === 'edge' ? interaction.edgeId : null;

  const showMinimap = useSetting('canvas.showMinimap');

  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;

    const observer = new ResizeObserver(([entry]) =>
      store.getState().setPane({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      }),
    );

    observer.observe(node);
    const box = node.getBoundingClientRect();
    store.getState().setPane({ width: box.width, height: box.height });

    return () => observer.disconnect();
  }, [store]);

  const fit = useCallback(() => {
    const { doc: current, pane: size, setView } = store.getState();
    if (!size.width || !size.height) return;
    setView(fitTo(boundsOf(current.nodes), size));
  }, [store]);

  const zoomFromCentre = useCallback(
    (next: number) => {
      const { view: current, pane: size, setView } = store.getState();
      setView(zoomAbout(current, next, size.width / 2, size.height / 2));
    },
    [store],
  );

  const zoomToSelection = useCallback(() => {
    const { doc: current, selection: ids, pane: size, setView } = store.getState();
    if (ids.size === 0 || !size.width) return;
    setView(fitTo(boundsOfIds(current, ids), size));
  }, [store]);

  /**
   * Where a new card goes: the middle of the screen, unless the context menu
   * set a point, since a card asked for by right-clicking belongs under the
   * pointer.
   */
  const placementRef = useRef<Point | null>(null);

  const addCard = useCallback(
    (type: Exclude<CanvasNodeType, 'unknown'>, extra?: Record<string, unknown>) => {
      const state = store.getState();
      const size = DEFAULT_NODE_SIZE[type];

      const anchorPoint =
        placementRef.current ??
        toCanvas(state.view, state.pane.width / 2, state.pane.height / 2);
      placementRef.current = null;

      // Centred then snapped, so a new card lands on the same lattice a
      // dragged one would.
      const step = getSetting('canvas.snapToGrid')
        ? snapStepForScale(state.view.scale)
        : 1;
      const at = {
        x: snapValue(anchorPoint.x - size.width / 2, step),
        y: snapValue(anchorPoint.y - size.height / 2, step),
      };

      const node = createNode(type, at, extra as never);
      state.commit(addNode(state.doc, node));
      state.select([node.id], 'replace');
      // Straight into edit mode: nobody adds an empty card to look at it.
      if (type === 'text') state.setEditing(node.id);
    },
    [store],
  );

  const [filePickerOpen, setFilePickerOpen] = useState(false);
  const [linkDialogOpen, setLinkDialogOpen] = useState(false);
  // Captured when the menu item is clicked, not read back when the dialog
  // submits: opening it moves focus off the board, and anything that changes
  // the selection in between must not redirect the rename.
  const [rename, setRename] = useState<
    { id: string; kind: RenameKind; value: string } | null
  >(null);

  const newTextCard = useCallback(() => addCard('text'), [addCard]);
  const newGroup = useCallback(() => addCard('group'), [addCard]);
  const newFileCard = useCallback(() => setFilePickerOpen(true), []);
  const newLinkCard = useCallback(() => setLinkDialogOpen(true), []);

  const { scopeId, claimSeat } = useCanvasCommands({
    store,
    fit,
    zoomToSelection,
    newTextCard,
    newFileCard,
    newGroup,
  });

  /*
   * Fitted on open. `pane` is a dependency because the first measurement
   * arrives after mount; `doc` deliberately is not, or every edit would throw
   * away the position the user had settled on. The ref makes it once per file.
   */
  const fittedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!pane.width || !pane.height) return;
    if (fittedFor.current === path) return;
    fittedFor.current = path;
    fit();
  }, [path, pane, fit]);

  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;

    const onWheel = (event: WheelEvent) => {
      // A card being edited owns its own scroll -- it carries the
      // `overflow: auto` in canvas.css. Bailing before `preventDefault` leaves
      // the wheel to do what it would over any scrollable element.
      //
      // Zoom is exempt: a distinct gesture, and it should still reach the
      // board while a card is being edited.
      const zooming = event.ctrlKey || event.metaKey;
      if (
        !zooming &&
        (event.target as HTMLElement | null)?.closest('[data-canvas-editing]')
      ) {
        return;
      }

      event.preventDefault();

      const { view: current, setView } = store.getState();
      const box = node.getBoundingClientRect();

      if (zooming) {
        const step =
          Math.abs(event.deltaY) < TOUCHPAD_DELTA ? TOUCHPAD_STEP : MOUSE_STEP;

        setView(
          zoomAbout(
            current,
            event.deltaY > 0 ? current.scale / step : current.scale * step,
            event.clientX - box.left,
            event.clientY - box.top,
          ),
        );
        return;
      }

      let dx = -event.deltaX;
      let dy = -event.deltaY;
      // Shift+wheel means "scroll horizontally", but plenty of platforms
      // (Chrome/Firefox on Windows/Linux, notably) already convert that
      // gesture into deltaX themselves before it reaches us -- deltaY comes
      // in as 0. Only remap manually when the browser hasn't, or this
      // overwrites an already-correct dx with nothing.
      if (event.shiftKey && dx === 0) {
        dx = dy;
        dy = 0;
      }

      setView({
        ...current,
        offset: { x: current.offset.x + dx, y: current.offset.y + dy },
      });
    };

    // Not passive: the tab must not scroll underneath the gesture.
    node.addEventListener('wheel', onWheel, { passive: false });
    return () => node.removeEventListener('wheel', onWheel);
  }, [store]);

  const { onPointerDown, onContextMenu, onKeyDown } =
    useCanvasGestures({ store, containerRef, placementRef, fit, zoomFromCentre });

  const applyColor = useCallback(
    (color: CanvasColor | undefined) => {
      const state = store.getState();
      state.commit(setColor(state.doc, state.selection, color));
    },
    [store],
  );

  // The colour the selection agrees on, or nothing when it does not.
  const selectionColor = (() => {
    const coloured = [...selection]
      .map(
        (id) =>
          doc.nodes.find((node) => node.id === id)?.color ??
          doc.edges.find((edge) => edge.id === id)?.color,
      )
      .filter((value, index, all) => all.indexOf(value) === index);
    return coloured.length === 1 ? coloured[0] : undefined;
  })();

  // Only when the whole selection is edges: a node in it leaves nothing for
  // "Start"/"End" to refer to.
  const selectedEdges = [...selection]
    .map((id) => doc.edges.find((edge) => edge.id === id))
    .filter((edge): edge is NonNullable<typeof edge> => edge !== undefined);

  const triState = (values: readonly EdgeEnd[]): TriState => {
    if (values.every((value) => value === 'arrow')) return 'on';
    if (values.every((value) => value === 'none')) return 'off';
    return 'mixed';
  };

  // One thing only: a multi-select rename would overwrite several names.
  const renameTarget = (() => {
    if (selection.size !== 1) return null;
    const [id] = [...selection];
    const node = doc.nodes.find((candidate) => candidate.id === id);
    if (node) {
      return node.type === 'group'
        ? { id, kind: 'group' as const, value: node.label ?? '' }
        : null;
    }
    const edge = doc.edges.find((candidate) => candidate.id === id);
    return edge ? { id, kind: 'edge' as const, value: edge.label ?? '' } : null;
  })();

  const edgeEnds =
    selectedEdges.length > 0 && selectedEdges.length === selection.size
      ? {
          from: triState(selectedEdges.map(fromEndOf)),
          to: triState(selectedEdges.map(toEndOf)),
        }
      : undefined;

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger
          render={
            <div
              ref={containerRef}
              tabIndex={0}
              data-command-surface='true'
              data-editor-id={scopeId}
              // What the pointer is doing, so the stylesheet can put one
              // cursor on the whole surface for the duration -- the pointer is
              // captured, so what it is over must not get a say.
              data-canvas-gesture={interaction.kind}
              data-canvas-resize={
                interaction.kind === 'resize' ? interaction.handle : undefined
              }
              className='absolute inset-0 cursor-default outline-none'
              onFocus={claimSeat}
              onPointerDown={onPointerDown}
              onKeyDown={onKeyDown}
              onContextMenu={onContextMenu}
            >
              <CanvasSurface
                doc={doc}
                view={view}
                sourcePath={path}
                selection={selection}
                editingNodeId={editingNodeId}
                hiddenEdgeId={hiddenEdgeId}
                interactive
                pane={pane}
                className='size-full'
              >
                <CanvasOverlays />
                {showMinimap && <CanvasMinimap />}
              </CanvasSurface>
            </div>
          }
        />

        <CanvasContextMenuContent
          hasSelection={selection.size > 0}
          selectionColor={selectionColor}
          onNewText={newTextCard}
          onNewGroup={newGroup}
          onNewFile={newFileCard}
          onNewLink={newLinkCard}
          onSetColor={applyColor}
          edgeEnds={edgeEnds}
          renameKind={renameTarget?.kind}
          onRename={() => renameTarget && setRename(renameTarget)}
          onSetEdgeEnd={(end, value) => {
            const state = store.getState();
            state.commit(
              setEdgeEnds(state.doc, state.selection, {
                [end === 'from' ? 'fromEnd' : 'toEnd']: value,
              }),
            );
          }}
          onDelete={() => {
            const state = store.getState();
            state.commit(removeSelection(state.doc, state.selection));
            state.clearSelection();
          }}
          onBringToFront={() => {
            const state = store.getState();
            state.commit(bringToFront(state.doc, state.selection));
          }}
          onSendToBack={() => {
            const state = store.getState();
            state.commit(sendToBack(state.doc, state.selection));
          }}
          onZoomToFit={fit}
          onZoomToSelection={zoomToSelection}
        />
      </ContextMenu>

      <CanvasFilePicker
        open={filePickerOpen}
        onOpenChange={setFilePickerOpen}
        onPick={(relativePath) => addCard('file', { file: relativePath })}
      />
      <CanvasRenameDialog
        open={rename !== null}
        kind={rename?.kind ?? 'group'}
        initialValue={rename?.value ?? ''}
        onOpenChange={(open) => {
          if (!open) setRename(null);
        }}
        onSubmit={(label) => {
          if (!rename) return;
          const state = store.getState();
          state.commit(setLabel(state.doc, rename.id, label));
        }}
      />
      <CanvasLinkDialog
        open={linkDialogOpen}
        onOpenChange={setLinkDialogOpen}
        onSubmit={(url) => addCard('link', { url })}
      />

      <div className='pointer-events-none absolute inset-x-0 bottom-4 z-20 flex justify-center px-4'>
        <ViewerToolbar>
          {/* The context menu's icons, so a card's type reads the same way
              whichever surface added it. */}
          <Button
            size='icon-sm'
            variant='ghost'
            title='New card'
            aria-label='New card'
            onClick={newTextCard}
          >
            <SquarePlus />
          </Button>
          <Button
            size='icon-sm'
            variant='ghost'
            title='New file card'
            aria-label='New file card'
            onClick={newFileCard}
          >
            <SquareChartGantt />
          </Button>
          <Button
            size='icon-sm'
            variant='ghost'
            title='New link card'
            aria-label='New link card'
            onClick={newLinkCard}
          >
            <Link2 />
          </Button>
          <Button
            size='icon-sm'
            variant='ghost'
            title='New group'
            aria-label='New group'
            onClick={newGroup}
          >
            <Group />
          </Button>

          <ViewerToolbarSeparator />

          <Button
            size='icon-sm'
            variant='ghost'
            title='Zoom out'
            aria-label='Zoom out'
            onClick={() => zoomFromCentre(stepScale(view.scale, -1))}
          >
            <Minus />
          </Button>
          {/* Fixed width so the toolbar does not twitch between 10% and 100%. */}
          <ViewerToolbarReadout className='w-12 text-center'>
            {Math.round(view.scale * 100)}%
          </ViewerToolbarReadout>
          <Button
            size='icon-sm'
            variant='ghost'
            title='Zoom in'
            aria-label='Zoom in'
            onClick={() => zoomFromCentre(stepScale(view.scale, 1))}
          >
            <Plus />
          </Button>

          <ViewerToolbarSeparator />

          <Button
            size='icon-sm'
            variant='ghost'
            title='Zoom to fit'
            aria-label='Zoom to fit'
            onClick={fit}
          >
            <Maximize2 />
          </Button>
          <Button
            size='xs'
            variant='ghost'
            title='Actual size (1)'
            onClick={() => zoomFromCentre(1)}
          >
            1:1
          </Button>
          <Button
            size='xs'
            variant='ghost'
            title='Zoom to selection'
            disabled={selection.size === 0}
            onClick={zoomToSelection}
          >
            Selection
          </Button>

          <ViewerToolbarSeparator />

          <Button
            size='icon-sm'
            variant={showMinimap ? 'default' : 'ghost'}
            title={showMinimap ? 'Hide minimap' : 'Show minimap'}
            aria-label={showMinimap ? 'Hide minimap' : 'Show minimap'}
            aria-pressed={showMinimap}
            onClick={() => setSetting('canvas.showMinimap', !showMinimap)}
          >
            <MapIcon />
          </Button>
        </ViewerToolbar>
      </div>
    </>
  );
}
