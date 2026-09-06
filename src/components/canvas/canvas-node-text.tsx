import type { TextNode } from '@/lib/canvas/types';
import { StaticMarkdown } from './static-markdown';

/**
 * A text card's read mode: rendered through the same schema the note editor
 * uses, so a heading or a wikilink looks the same on a board as in a note.
 */
export function CanvasNodeText({
  node,
  sourcePath,
}: {
  node: TextNode;
  sourcePath: string;
}) {
  if (node.text.trim() === '') {
    return <p className='text-sm text-muted-foreground italic'>Empty card</p>;
  }

  return <StaticMarkdown markdown={node.text} sourcePath={sourcePath} />;
}
