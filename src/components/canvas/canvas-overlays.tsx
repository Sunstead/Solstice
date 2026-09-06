import { marqueeRect, type Handle } from '@/lib/canvas/interaction';
import { rectOf } from '@/lib/canvas/doc';
import { anchorOf, edgeGeometry } from '@/lib/canvas/edge-geometry';
import type { NodeSide, Rect } from '@/lib/canvas/types';
import { useCanvasStore } from '@/lib/canvas/use-canvas-store';
import { toScreen, type Viewport } from '@/lib/canvas/viewport';

/**
 * Everything drawn over the board that is not part of the document: marquee,
 * alignment guides, resize zones, ports and the edge being drawn.
 *
 * All in screen space, so every size means what it says -- inside the zoom
 * transform a handle would be eight pixels at 100% and one at 12%.
 */

/**
 * Resize zones: the whole perimeter, invisible, with the cursor as the only
 * affordance. `CORNER` is the square claimed at each corner and `EDGE` the
 * thickness of each side strip, the strips inset by the corners so a corner
 * drag is never ambiguous.
 */
const CORNER = 16;
const EDGE = 9;

const CURSORS: Record<Handle, string> = {
  nw: 'nwse-resize',
  n: 'ns-resize',
  ne: 'nesw-resize',
  e: 'ew-resize',
  se: 'nwse-resize',
  s: 'ns-resize',
  sw: 'nesw-resize',
  w: 'ew-resize',
};

/** The eight zones for a card's screen rectangle. */
function resizeZones(box: Rect): { handle: Handle; style: React.CSSProperties }[] {
  const { x, y, width, height } = box;

  // A card smaller than its own corners has no room for side strips; the
  // corners still work.
  const spanX = Math.max(width - CORNER, 0);
  const spanY = Math.max(height - CORNER, 0);

  return [
    { handle: 'n', style: { left: x + CORNER / 2, top: y - EDGE / 2, width: spanX, height: EDGE } },
    { handle: 's', style: { left: x + CORNER / 2, top: y + height - EDGE / 2, width: spanX, height: EDGE } },
    { handle: 'w', style: { left: x - EDGE / 2, top: y + CORNER / 2, width: EDGE, height: spanY } },
    { handle: 'e', style: { left: x + width - EDGE / 2, top: y + CORNER / 2, width: EDGE, height: spanY } },

    // After the strips, so a corner wins any overlap on a very small card.
    { handle: 'nw', style: { left: x - CORNER / 2, top: y - CORNER / 2, width: CORNER, height: CORNER } },
    { handle: 'ne', style: { left: x + width - CORNER / 2, top: y - CORNER / 2, width: CORNER, height: CORNER } },
    { handle: 'se', style: { left: x + width - CORNER / 2, top: y + height - CORNER / 2, width: CORNER, height: CORNER } },
    { handle: 'sw', style: { left: x - CORNER / 2, top: y + height - CORNER / 2, width: CORNER, height: CORNER } },
  ];
}

/** The four points an edge can be dragged out of, one per side. */
const PORT_SIDES: NodeSide[] = ['top', 'right', 'bottom', 'left'];
const PORT_SIZE = 16;

/**
 * How far a port sits outside the card's edge, in screen pixels.
 *
 * Load-bearing: an edge midpoint is exactly where the `n`/`e`/`s`/`w` resize
 * zone is, so a port drawn there would sit on top of one, leaving no way to
 * tell the two affordances apart.
 */
const PORT_OFFSET = 12;

/** The grab dots on a selected edge's two ends. */
const EDGE_END_SIZE = 12;

/** Unit vector pointing out of a card through each side. */
const PORT_DIRECTION: Record<NodeSide, { x: number; y: number }> = {
  top: { x: 0, y: -1 },
  right: { x: 1, y: 0 },
  bottom: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
};

function screenRect(view: Viewport, rect: Rect): Rect {
  const origin = toScreen(view, rect);
  return {
    x: origin.x,
    y: origin.y,
    width: rect.width * view.scale,
    height: rect.height * view.scale,
  };
}

export function CanvasOverlays() {
  const interaction = useCanvasStore((state) => state.interaction);
  const selection = useCanvasStore((state) => state.selection);
  const doc = useCanvasStore((state) => state.doc);
  const view = useCanvasStore((state) => state.view);
  const editingNodeId = useCanvasStore((state) => state.editingNodeId);

  // Resize belongs to one node: with several selected there is no rectangle a
  // corner could anchor to without silently rescaling the rest.
  const selectedNodes = doc.nodes.filter((node) => selection.has(node.id));
  const only = selectedNodes.length === 1 ? selectedNodes[0] : null;

  /*
   * The one selected edge, so its ends can be marked. Only when exactly one is
   * selected: two edges sharing an endpoint would stack two handles in one
   * place with nothing to tell them apart.
   */
  const selectedEdge = (() => {
    const edges = doc.edges.filter((edge) => selection.has(edge.id));
    if (edges.length !== 1) return null;

    const edge = edges[0];
    const from = doc.nodes.find((node) => node.id === edge.fromNode);
    const to = doc.nodes.find((node) => node.id === edge.toNode);
    if (!from || !to) return null;

    return {
      geometry: edgeGeometry(
        screenRect(view, rectOf(from)),
        screenRect(view, rectOf(to)),
        edge,
        edge.fromNode === edge.toNode,
        view.scale,
      ),
    };
  })();

  // Ports show on the selected card only -- on hover they appeared under the
  // pointer every time it crossed a card. Not while editing, where the gesture
  // on offer is selecting text, and never on a group, since the spec has no
  // way to express an edge to a region.
  const portsFor =
    only && only.type !== 'group' && only.id !== editingNodeId ? only : null;

  return (
    <>
      {interaction.kind === 'marquee' &&
        (() => {
          const rect = marqueeRect(interaction);
          const origin = toScreen(view, rect);

          return (
            <div
              className='solstice-canvas-marquee'
              style={{
                left: origin.x,
                top: origin.y,
                width: rect.width * view.scale,
                height: rect.height * view.scale,
              }}
            />
          );
        })()}

      {interaction.kind === 'drag' &&
        interaction.guides.map((guide, index) => {
          const from = toScreen(view, { x: guide.from, y: guide.from });
          const at = toScreen(view, { x: guide.at, y: guide.at });
          const span = (guide.to - guide.from) * view.scale;

          return guide.axis === 'x' ? (
            <div
              key={`x${index}`}
              className='solstice-canvas-guide'
              style={{ left: at.x, top: from.y, width: 1, height: span }}
            />
          ) : (
            <div
              key={`y${index}`}
              className='solstice-canvas-guide'
              style={{ left: from.x, top: at.y, width: span, height: 1 }}
            />
          );
        })}

      {/* Where a selected edge's ends can be picked up. Dragging the line
          does the same thing; this is the affordance, not the only route. */}
      {selectedEdge && interaction.kind === 'idle' && (
        <>
          {(['start', 'end'] as const).map((which) => {
            const point = selectedEdge.geometry[which];

            return (
              <div
                key={which}
                className='solstice-canvas-edge-end'
                style={{
                  left: point.x - EDGE_END_SIZE / 2,
                  top: point.y - EDGE_END_SIZE / 2,
                  width: EDGE_END_SIZE,
                  height: EDGE_END_SIZE,
                }}
              />
            );
          })}
        </>
      )}

      {/* Ports show on the selected card. */}
      {portsFor && interaction.kind === 'idle' && (
        <>
          {PORT_SIDES.map((side) => {
            const edge = toScreen(view, anchorOf(rectOf(portsFor), side));
            const direction = PORT_DIRECTION[side];
            const point = {
              x: edge.x + direction.x * PORT_OFFSET,
              y: edge.y + direction.y * PORT_OFFSET,
            };

            return (
              <div key={`port-${side}`}>
                {/* A stub back to the card, so the dot reads as the start of
                    a line rather than a stray handle. */}
                <div
                  className='solstice-canvas-port-stub'
                  style={{
                    left: Math.min(edge.x, point.x),
                    top: Math.min(edge.y, point.y),
                    width: Math.max(Math.abs(point.x - edge.x), 1),
                    height: Math.max(Math.abs(point.y - edge.y), 1),
                  }}
                />
                <div
                  data-canvas-port={side}
                  data-canvas-port-node={portsFor.id}
                  className='solstice-canvas-port'
                  title='Drag to connect'
                  style={{
                    left: point.x - PORT_SIZE / 2,
                    top: point.y - PORT_SIZE / 2,
                    width: PORT_SIZE,
                    height: PORT_SIZE,
                  }}
                />
              </div>
            );
          })}
        </>
      )}

      {interaction.kind === 'edge' &&
        (() => {
          const from = doc.nodes.find((n) => n.id === interaction.anchorNode);
          if (!from) return null;

          const start = screenRect(view, rectOf(from));
          const target = interaction.hoverNode
            ? doc.nodes.find((n) => n.id === interaction.hoverNode)
            : null;

          // Snapped to the target's anchor when there is one, so the draft
          // shows the edge that would be created.
          const end = target
            ? screenRect(view, rectOf(target))
            : (() => {
                const p = toScreen(view, interaction.toPoint);
                return { x: p.x, y: p.y, width: 0, height: 0 };
              })();

          const geometry = edgeGeometry(
            start,
            end,
            {
              fromSide: interaction.anchorSide,
              toSide: interaction.hoverSide ?? undefined,
            },
            false,
            view.scale,
          );

          return (
            <svg className='solstice-canvas-edges'>
              <path
                className='solstice-canvas-edge-draft'
                d={geometry.d}
                strokeDasharray={target ? undefined : '6 5'}
              />
              <circle
                className='solstice-canvas-edge-draft-end'
                cx={geometry.end.x}
                cy={geometry.end.y}
                r={target ? 6 : 4}
              />
            </svg>
          );
        })()}

      {only && interaction.kind === 'idle' && (
        <>
          {resizeZones(screenRect(view, rectOf(only))).map(
            ({ handle, style }) => (
              <div
                key={handle}
                data-canvas-handle={handle}
                data-canvas-handle-node={only.id}
                className='solstice-canvas-handle'
                style={{ ...style, cursor: CURSORS[handle] }}
              />
            ),
          )}
        </>
      )}
    </>
  );
}
