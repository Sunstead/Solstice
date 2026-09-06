import { memo, useMemo } from 'react';

import { resolveCanvasColor } from '@/lib/canvas/color';
import {
  arrowPath,
  edgeGeometry,
  fromEndOf,
  toEndOf,
  type EdgeGeometry,
} from '@/lib/canvas/edge-geometry';
import { isEdgeDrawable, rectOf } from '@/lib/canvas/doc';
import type { CanvasDoc, CanvasEdge, CanvasNode, Rect } from '@/lib/canvas/types';
import { toScreen, type Viewport } from '@/lib/canvas/viewport';
import { TITLE_ONLY_SCALE } from './canvas-node';

/**
 * Every edge on the board, drawn in screen space rather than inside the zoom
 * transform -- a transformed `stroke-width` becomes a ribbon at 4x and a
 * hairline at 0.1x, and arrowheads and labels go the same way.
 *
 * Two layers, because they want opposite stacking: lines under the cards so an
 * edge never crosses a card's text, labels over them so they stay readable
 * when an edge runs between two adjacent cards.
 */

const STROKE_WIDTH = 2;
const MIN_STROKE = 1;
const MAX_STROKE = 4;

const ARROW_SIZE = 11;
const MIN_ARROW = 6;
const MAX_ARROW = 20;

const LABEL_SIZE = 12;
const MIN_LABEL = 9;
const MAX_LABEL = 18;

/** Screen pixels of slop around an edge, so a 2px line is still clickable. */
const HIT_WIDTH = 14;

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

function screenRect(view: Viewport, rect: Rect): Rect {
  const origin = toScreen(view, rect);
  return {
    x: origin.x,
    y: origin.y,
    width: rect.width * view.scale,
    height: rect.height * view.scale,
  };
}

export interface EdgeLayout {
  edge: CanvasEdge;
  geometry: EdgeGeometry;
  stroke: string;
}

/**
 * Geometry for every drawable edge, in screen space.
 *
 * Computed once and shared by both layers, so splitting lines from labels
 * costs one pass rather than two.
 */
export function useEdgeLayout(
  doc: CanvasDoc,
  nodes: Map<string, CanvasNode>,
  view: Viewport,
  selection: ReadonlySet<string>,
  /**
   * An edge to leave out entirely, while one of its ends is being dragged --
   * the overlay draws the live draft in its place.
   */
  hiddenEdgeId?: string | null,
): EdgeLayout[] {
  return useMemo(() => {
    const layouts: EdgeLayout[] = [];

    for (const edge of doc.edges) {
      if (edge.id === hiddenEdgeId) continue;

      // Kept in the document, but there is nothing to draw it between.
      if (!isEdgeDrawable(edge, nodes)) continue;

      const from = screenRect(view, rectOf(nodes.get(edge.fromNode)!));
      const to = screenRect(view, rectOf(nodes.get(edge.toNode)!));

      layouts.push({
        edge,
        geometry: edgeGeometry(
          from,
          to,
          edge,
          edge.fromNode === edge.toNode,
          view.scale,
        ),
        stroke:
          resolveCanvasColor(edge.color) ??
          (selection.has(edge.id) ? 'var(--ring)' : 'var(--muted-foreground)'),
      });
    }

    return layouts;
  }, [doc.edges, nodes, view, selection, hiddenEdgeId]);
}

export interface EdgeLayerProps {
  layouts: readonly EdgeLayout[];
  selection: ReadonlySet<string>;
  scale: number;
  interactive: boolean;
}

/** The lines, arrowheads and hit targets. Painted under the cards. */
export const CanvasEdgeLines = memo(function CanvasEdgeLines({
  layouts,
  selection,
  scale,
  interactive,
}: EdgeLayerProps) {
  const width = clamp(STROKE_WIDTH * scale, MIN_STROKE, MAX_STROKE);
  const arrow = clamp(ARROW_SIZE * scale, MIN_ARROW, MAX_ARROW);

  return (
    <svg className='solstice-canvas-edges' aria-hidden>
      {layouts.map(({ edge, geometry, stroke }) => {
        const selected = selection.has(edge.id);

        return (
          <g key={edge.id} opacity={selected ? 1 : 0.85}>
            {selected && (
              <path
                className='solstice-canvas-edge-path'
                d={geometry.d}
                stroke='var(--ring)'
                strokeWidth={width + 6}
                opacity={0.25}
              />
            )}

            <path
              className='solstice-canvas-edge-path'
              d={geometry.d}
              stroke={stroke}
              strokeWidth={selected ? width + 1 : width}
            />

            {fromEndOf(edge) === 'arrow' && (
              <path
                d={arrowPath(geometry.start, geometry.startAngle, arrow)}
                fill={stroke}
              />
            )}
            {toEndOf(edge) === 'arrow' && (
              <path
                d={arrowPath(geometry.end, geometry.endAngle, arrow)}
                fill={stroke}
              />
            )}

            {/* Invisible widened twin, so a hairline is still grabbable.
                Last in the group, so it sits above the visible paint. */}
            {interactive && (
              <path
                className='solstice-canvas-edge-hit'
                data-canvas-edge={edge.id}
                d={geometry.d}
                strokeWidth={HIT_WIDTH}
              />
            )}
          </g>
        );
      })}
    </svg>
  );
});

/** Just the labels. Painted over the cards so they stay readable. */
export const CanvasEdgeLabels = memo(function CanvasEdgeLabels({
  layouts,
  scale,
}: Pick<EdgeLayerProps, 'layouts' | 'scale'>) {
  const size = clamp(LABEL_SIZE * scale, MIN_LABEL, MAX_LABEL);

  // Labels go when cards give up their bodies: the font-size floor would
  // otherwise leave them the largest thing on a board being navigated.
  if (scale < TITLE_ONLY_SCALE) return null;

  return (
    <svg className='solstice-canvas-edges' aria-hidden>
      {layouts.map(({ edge, geometry }) =>
        edge.label ? (
          <text
            key={edge.id}
            className='solstice-canvas-edge-label'
            x={geometry.mid.x}
            y={geometry.mid.y}
            fontSize={size}
          >
            {edge.label}
          </text>
        ) : null,
      )}
    </svg>
  );
});
