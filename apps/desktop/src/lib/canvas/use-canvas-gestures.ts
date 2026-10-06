import { useCallback, useEffect, useRef, type RefObject } from 'react';

import {
  addEdge,
  moveNodes,
  placeNodes,
  rectOf,
  removeSelection,
  updateEdge,
} from '@/lib/canvas/doc';
import { snapStepForScale } from '@/lib/canvas/grid';
import { createCanvasId } from '@/lib/canvas/ids';
import {
  beginDrag,
  beginEdge,
  beginEdgeReattach,
  beginMarquee,
  beginResize,
  closerEnd,
  dragRects,
  IDLE,
  marqueeRect,
  PORT_SNAP_PX,
  updateDrag,
  updateEdgeDraw,
  updateResize,
  type Handle,
} from '@/lib/canvas/interaction';
import type { CanvasStore } from '@/lib/canvas/store';
import type { CanvasDoc, NodeSide, Point } from '@/lib/canvas/types';
import { clientToCanvas, pinchView, rectsIntersect, type Viewport } from '@/lib/canvas/viewport';
import { isEditableCard } from '@/lib/canvas/editable';
import { openLinkNode } from '@/components/canvas/canvas-node-link';
import { getSetting } from '@/lib/settings/store';

/**
 * Everything the pointer and the keyboard do to a board: the layer that turns
 * DOM events into the pure transitions in `interaction.ts`, holds the
 * gesture's base document for `commitGesture`, and throttles moves to one per
 * frame.
 */

/** How close together two presses on one card have to be to open it. */
const DOUBLE_PRESS_MS = 450;
const DOUBLE_PRESS_SLOP = 6;

export interface CanvasGestureOptions {
  store: CanvasStore;
  containerRef: RefObject<HTMLDivElement | null>;
  /** Where a card created from the context menu should land. */
  placementRef: RefObject<Point | null>;
  fit: () => void;
  zoomFromCentre: (scale: number) => void;
}

export function useCanvasGestures({
  store,
  containerRef,
  placementRef,
  fit,
  zoomFromCentre,
}: CanvasGestureOptions) {
  /** The document as the current gesture found it, for `commitGesture`. */
  const gestureBase = useRef<CanvasDoc | null>(null);
  const rafRef = useRef<number | null>(null);
  /** Space-drag pans, so a trackpad user is not stuck with marquee only. */
  const spaceRef = useRef(false);

  /** The previous press, for working out a double-press. */
  const lastPress = useRef<{
    id: string | null;
    time: number;
    x: number;
    y: number;
  }>({ id: null, time: 0, x: 0, y: 0 });

  /** A card whose second press landed; activated on release if it never moved. */
  const pendingActivate = useRef<string | null>(null);

  /*
   * Touch. One finger works like the mouse, except that on empty space it
   * pans rather than drawing a selection box. A second finger abandons
   * whatever the first one started and pinches: zoom with the spread, pan
   * with the midpoint.
   */
  const touches = useRef(new Map<number, Point>());
  const pinch = useRef<{ view: Viewport; from: [Point, Point] } | null>(null);
  /** Bumped to abandon the one-pointer gesture in progress. */
  const gestureId = useRef(0);

  useEffect(() => {
    const paneOf = (e: PointerEvent): Point => {
      const box = containerRef.current?.getBoundingClientRect();
      return { x: e.clientX - (box?.left ?? 0), y: e.clientY - (box?.top ?? 0) };
    };
    const onMove = (e: PointerEvent) => {
      if (!touches.current.has(e.pointerId)) return;
      touches.current.set(e.pointerId, paneOf(e));
      const p = pinch.current;
      if (!p || touches.current.size < 2) return;
      const [a, b] = [...touches.current.values()];
      store.getState().setView(pinchView(p.view, p.from, [a, b]));
    };
    const onUp = (e: PointerEvent) => {
      if (!touches.current.delete(e.pointerId)) return;
      if (touches.current.size < 2) pinch.current = null;
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [store, containerRef]);

  const onPointerDown = useCallback(
    (event: React.PointerEvent) => {
      const node = containerRef.current;
      if (!node) return;

      const target = event.target as HTMLElement;
      // A mounted editor owns its own events. Checked against the DOM rather
      // than `editingNodeId`, which can lag by a frame during a focus change.
      if (target.closest('[data-canvas-editing]')) return;

      const state = store.getState();
      const box = node.getBoundingClientRect();

      if (event.pointerType === 'touch') {
        touches.current.set(event.pointerId, {
          x: event.clientX - box.left,
          y: event.clientY - box.top,
        });
        if (touches.current.size >= 2) {
          event.preventDefault();
          if (pinch.current) return;
          // The first finger's gesture is dropped, and whatever it previewed
          // put back: a pinch never moves or selects anything.
          gestureId.current += 1;
          if (gestureBase.current) state.preview(gestureBase.current);
          gestureBase.current = null;
          pendingActivate.current = null;
          state.setInteraction(IDLE);
          const [a, b] = [...touches.current.values()];
          pinch.current = { view: state.view, from: [a, b] };
          return;
        }
      }

      // A press anywhere else ends editing -- here rather than on the editor's
      // blur, which also fires when the window loses focus.
      state.setEditing(null);
      const pointOf = (source: { clientX: number; clientY: number }) =>
        clientToCanvas(store.getState().view, source.clientX, source.clientY, box);

      const start = pointOf(event);
      // Alt is deliberately not a multi-select modifier: it frees a drag from
      // the grid, and one key cannot mean both.
      const additive = event.shiftKey || event.metaKey || event.ctrlKey;
      // Middle button or space; the right button belongs to the context menu.
      // A finger on empty space pans too: dragging a box out by touch is
      // rarely what's meant, and it leaves nothing to scroll the board with.
      const onEmpty = !target.closest(
        '[data-canvas-node], [data-canvas-port], [data-canvas-handle], [data-canvas-edge]',
      );
      const touchPan = event.pointerType === 'touch' && onEmpty;
      const wantsPan = event.button === 1 || spaceRef.current || touchPan;
      if (event.button === 2) return;

      event.preventDefault();
      node.focus();
      gestureBase.current = state.doc;

      const myGesture = ++gestureId.current;
      const pointerId = event.pointerId;

      if (wantsPan) {
        if (touchPan && !additive) state.clearSelection();
        state.setInteraction({
          kind: 'pan',
          startScreen: { x: event.clientX, y: event.clientY },
          startOffset: { ...state.view.offset },
        });
      } else {
        const portEl = target.closest('[data-canvas-port]');
        const handleEl = target.closest('[data-canvas-handle]');
        const edgeEl = target.closest('[data-canvas-edge]');
        const nodeEl = target.closest('[data-canvas-node]');

        if (portEl) {
          const side = portEl.getAttribute('data-canvas-port') as NodeSide;
          const from = portEl.getAttribute('data-canvas-port-node') ?? '';
          state.setInteraction(beginEdge(from, side, start));
        } else if (handleEl) {
          const handle = handleEl.getAttribute('data-canvas-handle') as Handle;
          const id = handleEl.getAttribute('data-canvas-handle-node') ?? '';
          state.setInteraction(beginResize(state.doc, id, handle, start));
        } else if (edgeEl) {
          const id = edgeEl.getAttribute('data-canvas-edge') ?? '';
          state.select([id], additive ? 'toggle' : 'replace');

          // Pressing the line also picks up whichever end is nearer, so an
          // edge is re-routed by dragging it the way it was drawn. A press
          // that never moves is just a selection -- `updateEdgeDraw` gates the
          // commit on the drag threshold.
          const edge = state.doc.edges.find((candidate) => candidate.id === id);
          const from = edge && state.doc.nodes.find((n) => n.id === edge.fromNode);
          const to = edge && state.doc.nodes.find((n) => n.id === edge.toNode);

          if (edge && from && to) {
            state.setInteraction(
              beginEdgeReattach(
                edge,
                closerEnd(rectOf(from), rectOf(to), edge, start),
                start,
              ),
            );
          }
        } else if (nodeEl) {
          const id = nodeEl.getAttribute('data-canvas-node') ?? '';

          /*
           * Double-press, tracked by hand rather than read from `dblclick`.
           * The `preventDefault()` above suppresses the compatibility mouse
           * events -- `click` and `dblclick` among them -- that the Pointer
           * Events spec derives from a pointerdown, so no `dblclick` listener
           * here would ever fire.
           */
          const previous = lastPress.current;
          const isDoublePress =
            previous.id === id &&
            event.timeStamp - previous.time < DOUBLE_PRESS_MS &&
            Math.abs(event.clientX - previous.x) < DOUBLE_PRESS_SLOP &&
            Math.abs(event.clientY - previous.y) < DOUBLE_PRESS_SLOP;

          lastPress.current = {
            id,
            time: event.timeStamp,
            x: event.clientX,
            y: event.clientY,
          };

          // Acted on at the release, not here: a native `dblclick` fires on
          // the second mouse *up* so that pressing twice and then dragging is
          // a drag rather than an activation.
          pendingActivate.current = isDoublePress ? id : null;
          // Cleared so a third press starts a fresh pair.
          if (isDoublePress) lastPress.current = { id: null, time: 0, x: 0, y: 0 };

          if (additive) state.select([id], 'toggle');
          // Pressing inside a multi-selection keeps it, so the whole group can
          // be dragged; pressing outside one replaces it.
          else if (!state.selection.has(id)) state.select([id], 'replace');

          const current = store.getState().selection;
          if (current.has(id)) {
            state.setInteraction(beginDrag(state.doc, current, id, start));
          }
        } else {
          lastPress.current = { id: null, time: 0, x: 0, y: 0 };
          if (!additive) state.clearSelection();
          state.setInteraction(
            beginMarquee(start, additive ? state.selection : new Set()),
          );
        }
      }

      // Best effort: capture keeps a fast drag from dropping, but throws if
      // the pointer is already gone, and the gesture works without it. The
      // listeners below are on `window` for the same reason -- a drag that
      // leaves the surface still has to end.
      try {
        node.setPointerCapture(event.pointerId);
      } catch {
        // Ignored.
      }

      const apply = (moveEvent: PointerEvent) => {
        if (gestureId.current !== myGesture) return;
        const live = store.getState();
        const interaction = live.interaction;
        const point = pointOf(moveEvent);

        // Read from the live event, so Alt takes effect mid-drag.
        const snap = {
          scale: live.view.scale,
          enabled: getSetting('canvas.snapToGrid') && !moveEvent.altKey,
        };

        switch (interaction.kind) {
          case 'pan': {
            live.setView({
              ...live.view,
              offset: {
                x: interaction.startOffset.x + (moveEvent.clientX - interaction.startScreen.x),
                y: interaction.startOffset.y + (moveEvent.clientY - interaction.startScreen.y),
              },
            });
            break;
          }

          case 'marquee':
            live.setInteraction({ ...interaction, currentCanvas: point });
            break;

          case 'drag': {
            const next = updateDrag(interaction, point, snap);
            live.setInteraction(next);
            if (next.kind === 'drag' && next.moved && gestureBase.current) {
              live.preview(placeNodes(gestureBase.current, dragRects(next)));
            }
            break;
          }

          case 'edge': {
            live.setInteraction(
              updateEdgeDraw(
                interaction,
                point,
                live.doc,
                // Converted to canvas units, so a port is equally easy to hit
                // at every zoom.
                PORT_SNAP_PX / live.view.scale,
              ),
            );
            break;
          }

          case 'resize': {
            const next = updateResize(interaction, point, snap);
            live.setInteraction(next);
            if (next.kind === 'resize' && gestureBase.current) {
              live.preview(
                placeNodes(gestureBase.current, new Map([[next.id, next.rect]])),
              );
            }
            break;
          }
        }
      };

      const onMove = (moveEvent: PointerEvent) => {
        // Another finger's moves are the pinch's business.
        if (moveEvent.pointerId !== pointerId) return;
        if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
        rafRef.current = requestAnimationFrame(() => {
          rafRef.current = null;
          apply(moveEvent);
        });
      };

      const onUp = (upEvent: PointerEvent) => {
        if (upEvent.pointerId !== pointerId) return;
        if (rafRef.current !== null) {
          cancelAnimationFrame(rafRef.current);
          rafRef.current = null;
        }

        if (gestureId.current !== myGesture) {
          // Abandoned for a pinch: nothing to commit.
          window.removeEventListener('pointermove', onMove);
          window.removeEventListener('pointerup', onUp);
          window.removeEventListener('pointercancel', onUp);
          return;
        }

        // Synchronously, before committing: moves are throttled to one per
        // frame, so a gesture whose last move and release share a frame would
        // otherwise commit a stale position -- or, for a flick fast enough
        // that no frame ran, discard the drag entirely.
        apply(upEvent);

        const live = store.getState();
        const interaction = live.interaction;
        const before = gestureBase.current;

        const activateId = pendingActivate.current;
        pendingActivate.current = null;

        // A double press that stayed put activates the card; one that moved is
        // an ordinary drag, handled below.
        if (
          activateId &&
          interaction.kind === 'drag' &&
          !interaction.moved
        ) {
          const node = live.doc.nodes.find(
            (candidate) => candidate.id === activateId,
          );

          if (node && isEditableCard(node)) {
            live.select([activateId], 'replace');
            live.setEditing(activateId);
          } else if (node?.type === 'link') {
            openLinkNode(node.url);
          }
        }

        if (interaction.kind === 'marquee') {
          const rect = marqueeRect(interaction);
          const hits = live.doc.nodes
            .filter((candidate) => rectsIntersect(rectOf(candidate), rect))
            .map((candidate) => candidate.id);

          live.select([...interaction.base, ...hits], 'replace');
        } else if (interaction.kind === 'edge') {
          if (interaction.hoverNode && interaction.moved && before) {
            // Dropped on a card: create the edge, or re-point the end being
            // dragged.
            const end = {
              node: interaction.hoverNode,
              side: interaction.hoverSide ?? undefined,
            };

            live.commitGesture(
              before,
              interaction.edgeId === null
                ? addEdge(before, {
                    id: createCanvasId(),
                    fromNode: interaction.anchorNode,
                    fromSide: interaction.anchorSide,
                    toNode: end.node,
                    toSide: end.side,
                  })
                : updateEdge(
                    before,
                    interaction.edgeId,
                    interaction.movingEnd === 'from'
                      ? { fromNode: end.node, fromSide: end.side }
                      : { toNode: end.node, toSide: end.side },
                  ),
            );
          } else if (interaction.edgeId !== null && interaction.moved && before) {
            // An existing edge let go over nothing is deleted. A new one being
            // drawn simply never gets created, by the branch above.
            live.commitGesture(
              before,
              removeSelection(before, new Set([interaction.edgeId])),
            );
          }
        } else if (before) {
          // One commit per gesture; every frame in between was a preview.
          if (interaction.kind === 'drag' && interaction.moved) {
            live.commitGesture(before, placeNodes(before, dragRects(interaction)));
          } else if (interaction.kind === 'resize') {
            live.commitGesture(
              before,
              placeNodes(before, new Map([[interaction.id, interaction.rect]])),
            );
          }
        }

        gestureBase.current = null;
        live.setInteraction(IDLE);

        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);
      };

      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
    },
    [store],
  );

  const onContextMenu = useCallback(
    (event: React.MouseEvent) => {
      const node = containerRef.current;
      if (!node) return;

      const state = store.getState();
      const box = node.getBoundingClientRect();
      // Remembered so "New card" from this menu lands where it was opened.
      placementRef.current = clientToCanvas(
        state.view,
        event.clientX,
        event.clientY,
        box,
      );

      const target = event.target as HTMLElement;
      const nodeEl = target.closest('[data-canvas-node]');
      const edgeEl = target.closest('[data-canvas-edge]');
      const id =
        nodeEl?.getAttribute('data-canvas-node') ??
        edgeEl?.getAttribute('data-canvas-edge');

      // Right-clicking something that is not already selected selects it, so
      // the menu always acts on what was actually pointed at.
      if (id && !state.selection.has(id)) state.select([id], 'replace');
      else if (!id) state.clearSelection();
    },
    [store],
  );

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      const target = event.target as HTMLElement;
      const state = store.getState();
      const inEditor = Boolean(target.closest('[data-canvas-editing]'));

      // The one key that still means something inside a card. Judged on the
      // same two signals as the guard below, so an editor that is open but has
      // not taken focus is still closable.
      if (event.key === 'Escape') {
        event.preventDefault();
        if (inEditor || state.editingNodeId !== null) {
          state.setEditing(null);
          containerRef.current?.focus();
          return;
        }
        state.clearSelection();
        return;
      }

      /*
       * Everything below is a board shortcut; inside a card they are ordinary
       * text input, and Delete in particular must take a character rather than
       * the card around it.
       *
       * Two signals on purpose. The DOM check follows where the keystroke came
       * from; `editingNodeId` is the safety net, because an editor that has
       * mounted but not taken focus leaves the board focused and a Backspace
       * would then delete the card being typed into.
       */
      if (inEditor || state.editingNodeId !== null) return;

      if (event.key === ' ') {
        spaceRef.current = true;
        event.preventDefault();
        return;
      }

      if (event.key === 'Delete' || event.key === 'Backspace') {
        if (state.selection.size === 0) return;
        event.preventDefault();
        state.commit(removeSelection(state.doc, state.selection));
        state.clearSelection();
        return;
      }

      if (event.key === 'Enter' && state.selection.size === 1) {
        const id = [...state.selection][0];
        const node = state.doc.nodes.find((candidate) => candidate.id === id);
        if (node && isEditableCard(node)) {
          event.preventDefault();
          state.setEditing(id);
          return;
        }
      }

      /*
       * Bound here rather than left to the command system: on macOS the Edit
       * menu's Undo is a `PredefinedMenuItem` wired to the responder chain,
       * which never emits a `MenuCommand`, so the scoped registration alone
       * leaves a board with a dead Cmd+Z. The keydown reaches the page because
       * the surface is not editable.
       *
       * Inside a card the guard above has already returned, leaving the key to
       * ProseMirror's own history.
       */
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) state.redo();
        else state.undo();
        return;
      }

      // Windows' other redo convention.
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'y') {
        event.preventDefault();
        state.redo();
        return;
      }

      if (event.key === 'a' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        state.select(state.doc.nodes.map((node) => node.id), 'replace');
        return;
      }

      if (event.key === '0') {
        event.preventDefault();
        fit();
        return;
      }

      if (event.key === '1') {
        event.preventDefault();
        zoomFromCentre(1);
        return;
      }

      // One grid step, or one unit with Alt held -- the same distinction the
      // modifier makes during a drag.
      const nudge: Record<string, [number, number]> = {
        ArrowUp: [0, -1],
        ArrowDown: [0, 1],
        ArrowLeft: [-1, 0],
        ArrowRight: [1, 0],
      };

      const direction = nudge[event.key];
      if (direction && state.selection.size > 0) {
        event.preventDefault();
        const step = event.altKey ? 1 : snapStepForScale(state.view.scale);
        state.commit(
          moveNodes(state.doc, state.selection, {
            x: direction[0] * step,
            y: direction[1] * step,
          }),
        );
      }
    },
    [store, fit, zoomFromCentre],
  );

  useEffect(() => {
    const clearSpace = (event: KeyboardEvent) => {
      if (event.key === ' ') spaceRef.current = false;
    };
    // On the window, or releasing space outside the board would leave the
    // surface stuck in pan mode.
    window.addEventListener('keyup', clearSpace);
    return () => window.removeEventListener('keyup', clearSpace);
  }, []);

  useEffect(
    () => () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    },
    [],
  );

  return { onPointerDown, onContextMenu, onKeyDown };
}
