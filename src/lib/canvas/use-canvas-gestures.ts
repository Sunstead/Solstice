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
import { clientToCanvas, rectsIntersect } from '@/lib/canvas/viewport';
import { isEditableCard } from '@/lib/canvas/editable';
import { openLinkNode } from '@/components/canvas/canvas-node-link';
import { getSetting } from '@/lib/settings/store';

/**
 * Everything the pointer and the keyboard do to a board.
 *
 * Extracted from the board component, which was otherwise a six-hundred-line
 * switch wrapped in some JSX. The transitions themselves are pure and live in
 * `interaction.ts`; this is the layer that turns DOM events into them, holds
 * the gesture's base document for `commitGesture`, and throttles moves to one
 * per frame.
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

  const onPointerDown = useCallback(
    (event: React.PointerEvent) => {
      const node = containerRef.current;
      if (!node) return;

      const target = event.target as HTMLElement;
      // A mounted editor owns its own events entirely. Checked against the DOM
      // rather than against `editingNodeId`, which can disagree with reality
      // for a frame during a focus transition.
      if (target.closest('[data-canvas-editing]')) return;

      const state = store.getState();
      // A press anywhere else ends editing. Done here rather than on the
      // editor's blur, because a blur also fires when the window loses focus,
      // and coming back to a card that quietly stopped being editable is worse
      // than one that stayed.
      state.setEditing(null);
      const box = node.getBoundingClientRect();
      const pointOf = (source: { clientX: number; clientY: number }) =>
        clientToCanvas(store.getState().view, source.clientX, source.clientY, box);

      const start = pointOf(event);
      // Shift and the platform's own multi-select modifier both extend a
      // selection. Alt is left alone: it is what frees a drag from the grid,
      // and one key cannot mean both.
      const additive = event.shiftKey || event.metaKey || event.ctrlKey;
      // Middle button or space. Right-drag used to pan, as it does in the
      // image viewer, but a board needs its right button for the context menu
      // far more than it needs a third way to pan.
      const wantsPan = event.button === 1 || spaceRef.current;
      if (event.button === 2) return;

      event.preventDefault();
      node.focus();
      gestureBase.current = state.doc;

      if (wantsPan) {
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

          // Pressing the line also picks up whichever end is nearer, so an edge
          // can be re-routed by dragging it the way it was drawn. A press that
          // never moves is just a selection: `updateEdgeDraw` gates the commit
          // on the drag threshold.
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
           * Double-press, worked out here rather than from a `dblclick` handler.
           *
           * `preventDefault()` above suppresses the compatibility mouse events
           * the Pointer Events spec derives from a pointerdown -- `click` and
           * `dblclick` among them -- so a `dblclick` listener on this surface
           * never fires at all. Tracking the previous press is the only way to
           * see the gesture without giving up the preventDefault that stops
           * native text selection and image dragging mid-drag.
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

          /*
           * Noted, but not acted on until the release.
           *
           * A native `dblclick` fires on the second *mouse up* precisely so
           * that pressing twice and then dragging is a drag, not an activation.
           * Acting here instead would mean a card selected a moment ago could
           * not be picked up and moved -- the second press would put a caret in
           * it rather than grabbing it.
           */
          pendingActivate.current = isDoublePress ? id : null;
          if (isDoublePress) {
            // Cleared so a third press starts a fresh pair rather than counting
            // as another double.
            lastPress.current = { id: null, time: 0, x: 0, y: 0 };
          }

          if (additive) state.select([id], 'toggle');
          // Clicking inside an existing multi-selection keeps it, so the whole
          // group can be dragged; clicking outside one replaces it.
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

      // Best effort. Capture keeps a fast drag that outruns the cursor from
      // dropping, but it throws if the pointer is already gone -- and losing
      // the whole gesture, listeners included, is far worse than losing the
      // capture. The listeners below go on `window` for the same reason, so a
      // drag that leaves the surface still ends properly.
      try {
        node.setPointerCapture(event.pointerId);
      } catch {
        // Nothing to do: the gesture works without it.
      }

      const apply = (moveEvent: PointerEvent) => {
        const live = store.getState();
        const interaction = live.interaction;
        const point = pointOf(moveEvent);

        // Read from the live event, not latched at gesture start, so Alt can be
        // pressed and released mid-drag and take effect immediately.
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
                // A screen-pixel reach converted to canvas units, so a port is
                // equally easy to hit at every zoom.
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
        if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
        rafRef.current = requestAnimationFrame(() => {
          rafRef.current = null;
          apply(moveEvent);
        });
      };

      const onUp = (upEvent: PointerEvent) => {
        if (rafRef.current !== null) {
          cancelAnimationFrame(rafRef.current);
          rafRef.current = null;
        }

        // Apply the release position synchronously before committing.
        //
        // Moves are throttled to one per frame, so a gesture whose last move
        // and release land in the same frame would otherwise commit the
        // second-to-last position -- or, for a flick fast enough that no frame
        // ran at all, commit nothing and silently discard the drag. Reading the
        // release event is also simply more correct: where the pointer was let
        // go is where the node belongs.
        apply(upEvent);

        const live = store.getState();
        const interaction = live.interaction;
        const before = gestureBase.current;

        const activateId = pendingActivate.current;
        pendingActivate.current = null;

        // A double press that stayed put activates the card -- typing in one
        // that holds text, following one that holds a URL. Having moved makes
        // it an ordinary drag, handled below.
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
            // A real edge, dragged and let go over nothing: deleted, matching
            // the reference implementation this ported from. A fresh edge
            // being drawn out of a port has no such case -- there was nothing
            // to delete, so it simply never gets created (the branch above).
            live.commitGesture(
              before,
              removeSelection(before, new Set([interaction.edgeId])),
            );
          }
        } else if (before) {
          // One commit per gesture: every frame in between was a preview the
          // history never saw, which is why no coalescing is needed anywhere.
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

      // Escape is the way out of a card, so it is the one key that still means
      // something inside one. Judged on the same two signals the guard below
      // uses: an editor that is open but has not taken focus still has to be
      // closable, or nothing can dismiss it and every board shortcut stays shut
      // off behind it.
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
       * Everything below is a board shortcut. Inside a card being edited they
       * are ordinary text input, and `Delete` in particular must delete a
       * character rather than the card around it.
       *
       * Checked two ways on purpose. The DOM check is the accurate one -- it
       * follows where the keystroke actually came from. `editingNodeId` is the
       * safety net: an editor that has mounted but not yet taken focus leaves
       * the surface itself focused, and a Backspace then arrives with the board
       * as its target and deletes the very card the user thinks they are typing
       * in. Losing a card that way is bad enough to be worth the cost of the
       * board's own shortcuts going quiet while a card is open.
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
       * Undo and redo, bound here rather than left to the command system.
       *
       * On macOS the Edit menu's Undo is a `PredefinedMenuItem`, which is an
       * OS-native item wired to the responder chain -- it never emits a
       * `MenuCommand` event, so `runCommand('native.undo')` is never called and
       * the scoped registration alone would leave a board with a dead Cmd+Z.
       * A plain keydown works because the surface is not editable: WebKit
       * disables `undo:` with no editable focus, `performKeyEquivalent:`
       * returns NO, and the event reaches the page.
       *
       * Inside a card the check above has already returned, leaving the key to
       * ProseMirror's own history -- which is the right granularity there.
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

      // Arrow keys nudge by one grid step, or by one unit with Alt held --
      // the same distinction the modifier makes during a drag.
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
    // On the window, so releasing space outside the board still clears it and
    // the surface is not left permanently in pan mode.
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
