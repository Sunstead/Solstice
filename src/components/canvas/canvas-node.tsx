import { memo } from 'react';
import { FileQuestion } from 'lucide-react';

import { resolveCanvasColor } from '@/lib/canvas/color';
import type { CanvasNode as Node } from '@/lib/canvas/types';
import { basename } from '@/lib/wikilink/target';
import { CanvasNodeFile } from './canvas-node-file';
import { CanvasNodeLink, hostnameOf } from './canvas-node-link';
import { CanvasNodeText } from './canvas-node-text';
import { CanvasCardEditor } from './canvas-card-editor';
import { isEditableCard } from '@/lib/canvas/editable';

/**
 * Below this zoom, WKWebView rasterises card text at the scaled resolution and
 * it stops being legible. Showing a title instead is a legibility fix and a
 * large rendering win at once -- at this zoom a board is being navigated, not
 * read.
 */
export const TITLE_ONLY_SCALE = 0.4;

/** A one-line stand-in for a card at a zoom where its body cannot be read. */
function titleOf(node: Node): string {
  switch (node.type) {
    case 'text': {
      const firstLine = node.text.split('\n').find((line) => line.trim() !== '');
      return firstLine?.replace(/^#{1,6}\s*/, '').trim() || 'Empty card';
    }
    case 'file':
      return node.file ? basename(node.file) : 'No file';
    case 'link':
      return hostnameOf(node.url) ?? node.url ?? 'No URL';
    case 'group':
      return node.label ?? 'Group';
    default:
      return node.unknownType || 'Unsupported';
  }
}

/** Groups are a different shape entirely and never reach here. */
function NodeBody({
  node,
  sourcePath,
}: {
  node: Exclude<Node, { type: 'group' }>;
  sourcePath: string;
}) {
  switch (node.type) {
    case 'text':
      return <CanvasNodeText node={node} sourcePath={sourcePath} />;
    case 'file':
      return <CanvasNodeFile node={node} />;
    case 'link':
      return <CanvasNodeLink node={node} />;
    default:
      // A card type this version does not know. Rendered rather than hidden so
      // it can be moved out of the way, and never rewritten.
      return (
        <div className='flex h-full flex-col items-center justify-center gap-2 text-center text-muted-foreground'>
          <FileQuestion className='size-8 shrink-0' />
          <p className='text-xs break-all'>
            Unsupported card{node.unknownType ? `: ${node.unknownType}` : ''}
          </p>
        </div>
      );
  }
}

export interface CanvasNodeProps {
  node: Node;
  selected: boolean;
  /** The board's zoom, for the title-only threshold. */
  scale: number;
  /** The `.canvas` file's own path; relative links resolve against it. */
  sourcePath: string;
  /** This card holds the live editor. At most one card on a board does. */
  editing?: boolean;
}

/**
 * One card.
 *
 * Carries the `data-canvas-node` attribute the surface's delegated pointer
 * handler reads, and nothing else about interaction: hit testing is the
 * browser's job here, since it already knows about z-order, transforms and
 * rounded corners -- and it is the only approach under which a real editor
 * mounted inside a card keeps working.
 */
export const CanvasNode = memo(function CanvasNode({
  node,
  selected,
  scale,
  sourcePath,
  editing = false,
}: CanvasNodeProps) {
  const color = resolveCanvasColor(node.color);
  const geometry = {
    left: node.x,
    top: node.y,
    width: node.width,
    height: node.height,
  };

  // A custom property rather than a class per preset, so the six spec colours
  // and an arbitrary hex take exactly the same path through the stylesheet.
  const accent = color
    ? ({ '--canvas-node-color': color } as React.CSSProperties)
    : undefined;

  if (node.type === 'group') {
    return (
      <div
        data-canvas-node={node.id}
        data-selected={selected || undefined}
        className='solstice-canvas-group'
        style={{
          ...geometry,
          ...accent,
          backgroundImage: node.background
            ? `url(${CSS.escape(node.background)})`
            : undefined,
          backgroundSize:
            node.backgroundStyle === 'cover'
              ? 'cover'
              : node.backgroundStyle === 'ratio'
                ? 'contain'
                : undefined,
          backgroundRepeat:
            node.backgroundStyle === 'repeat' ? 'repeat' : 'no-repeat',
        }}
      >
        {node.label && (
          <div
            className='solstice-canvas-group-label'
            // Counter-scaled so a group's name stays readable at any zoom,
            // which is the whole point of a label on a region this large.
            style={{ fontSize: `${Math.min(14 / scale, 14 / TITLE_ONLY_SCALE)}px` }}
          >
            {node.label}
          </div>
        )}
      </div>
    );
  }

  // Never title-only while editing: the caret has to be in something.
  const titleOnly = scale < TITLE_ONLY_SCALE && !editing;
  const liveEditor = editing && isEditableCard(node);

  return (
    <div
      data-canvas-node={node.id}
      data-selected={selected || undefined}
      // The one attribute the board's pointer and key handlers look for before
      // doing anything. Read from the DOM rather than from `editingNodeId`,
      // which can disagree with reality for a frame during a focus transition.
      data-canvas-editing={liveEditor ? '' : undefined}
      className='solstice-canvas-node'
      style={{ ...geometry, ...accent }}
    >
      {titleOnly ? (
        <div
          className='solstice-canvas-node-glyph'
          style={{ fontSize: `${14 / scale}px` }}
        >
          <span className='truncate'>{titleOf(node)}</span>
        </div>
      ) : (
        <div
          className='solstice-canvas-node-body'
          data-clipped={liveEditor ? undefined : 'true'}
          // A card being edited is flush too: the editor inside carries the
          // inset, so read and edit mode put the text in the same place.
          data-flush={
            node.type === 'file' || node.type === 'link' || liveEditor
              ? ''
              : undefined
          }
        >
          {liveEditor ? (
            <CanvasCardEditor node={node} />
          ) : (
            <NodeBody node={node} sourcePath={sourcePath} />
          )}
        </div>
      )}
    </div>
  );
});
