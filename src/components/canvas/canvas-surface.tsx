import { memo, useMemo } from 'react';

import { CanvasGrid } from '@/components/viewer/canvas-grid';
import { nodeMap, rectOf } from '@/lib/canvas/doc';
import type { CanvasDoc, CanvasNode as Node, Size } from '@/lib/canvas/types';
import {
  rectsIntersect,
  visibleRect,
  type Viewport,
} from '@/lib/canvas/viewport';
import { cn } from '@/lib/utils';
import {
  CanvasEdgeLabels,
  CanvasEdgeLines,
  useEdgeLayout,
} from './canvas-edges';
import { CanvasNode } from './canvas-node';

/**
 * Everything a board *looks* like, and nothing about how it is edited.
 *
 * This component never imports the canvas store. That is the whole seam
 * between the `.canvas` tab and the read-only preview a note embeds: both
 * render through here, so the preview cannot drift from the editor as the
 * editor grows. The tab passes selection and its own overlays as children; the
 * preview passes `interactive={false}` and nothing else.
 */

/** Above this many nodes, cards outside the viewport stop being rendered. */
const VIRTUALIZE_ABOVE = 150;

export interface CanvasSurfaceProps {
  doc: CanvasDoc;
  view: Viewport;
  /** The `.canvas` file's own path; relative links resolve against it. */
  sourcePath: string;
  selection?: ReadonlySet<string>;
  editingNodeId?: string | null;
  /** An edge to leave out of both edge layers -- see `useEdgeLayout`. */
  hiddenEdgeId?: string | null;
  /**
   * False renders a board nobody can touch: no pointer targets on the edges, no
   * hover affordances, no per-node editors.
   */
  interactive: boolean;
  /** The pane's pixel size. Without it, nothing is culled. */
  pane?: Size;
  className?: string;
  /** Overlays, toolbars and the minimap, in screen space above the content. */
  children?: React.ReactNode;
}

const EMPTY_SELECTION: ReadonlySet<string> = new Set();

export const CanvasSurface = memo(function CanvasSurface({
  doc,
  view,
  sourcePath,
  selection = EMPTY_SELECTION,
  editingNodeId = null,
  hiddenEdgeId = null,
  interactive,
  pane,
  className,
  children,
}: CanvasSurfaceProps) {
  const nodes = useMemo(() => nodeMap(doc), [doc]);
  const edgeLayouts = useEdgeLayout(doc, nodes, view, selection, hiddenEdgeId);

  const visible = useMemo(() => {
    if (!pane || doc.nodes.length <= VIRTUALIZE_ABOVE) return doc.nodes;

    // One viewport of margin, so a card is mounted before it scrolls in rather
    // than popping into existence at the edge.
    const box = visibleRect(view, pane);
    const margin = {
      x: box.x - box.width / 2,
      y: box.y - box.height / 2,
      width: box.width * 2,
      height: box.height * 2,
    };

    return doc.nodes.filter(
      (node) =>
        // Culling the card being edited would destroy a live editor mid-edit,
        // and culling a selected one would take its handles away the moment it
        // was scrolled to the edge. Both are guards, not optimisations.
        node.id === editingNodeId ||
        selection.has(node.id) ||
        rectsIntersect(rectOf(node), margin),
    );
  }, [doc.nodes, pane, view, editingNodeId, selection]);

  // Groups paint behind everything, largest first, so a group nested inside
  // another is still on top of it and still clickable.
  const groups = useMemo(
    () =>
      visible
        .filter((node): node is Extract<Node, { type: 'group' }> =>
          node.type === 'group',
        )
        .sort((a, b) => b.width * b.height - a.width * a.height),
    [visible],
  );

  // Everything else in array order, which is the stacking the file records.
  const cards = useMemo(
    () => visible.filter((node) => node.type !== 'group'),
    [visible],
  );

  const worldStyle = {
    transform: `translate(${view.offset.x}px, ${view.offset.y}px) scale(${view.scale})`,
  };

  return (
    <div
      className={cn('solstice-canvas-board', className)}
      data-interactive={interactive}
    >
      <CanvasGrid scale={view.scale} offset={view.offset} />

      {/*
        Two transformed containers rather than one, so the edge overlay can sit
        between them: groups below the lines, cards above. A single container
        could not sandwich a screen-space sibling.
      */}
      <div className='solstice-canvas-world' style={worldStyle}>
        {groups.map((node) => (
          <CanvasNode
            key={node.id}
            node={node}
            selected={selection.has(node.id)}
            scale={view.scale}
            sourcePath={sourcePath}
          />
        ))}
      </div>

      <CanvasEdgeLines
        layouts={edgeLayouts}
        selection={selection}
        scale={view.scale}
        interactive={interactive}
      />

      <div className='solstice-canvas-world' style={worldStyle}>
        {cards.map((node) => (
          <CanvasNode
            key={node.id}
            node={node}
            selected={selection.has(node.id)}
            scale={view.scale}
            sourcePath={sourcePath}
            editing={node.id === editingNodeId}
          />
        ))}
      </div>

      {/* Over the cards, unlike the lines: an edge between two adjacent cards
          has nowhere to put its label except on top of one of them. */}
      <CanvasEdgeLabels layouts={edgeLayouts} scale={view.scale} />

      {children}
    </div>
  );
});
