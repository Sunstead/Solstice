import type { TextNode } from '@/lib/canvas/types';
import { StaticMarkdown } from './static-markdown';

/**
 * A text card's read mode.
 *
 * Rendered rather than shown as source, through the same schema the note
 * editor uses -- so a heading, a wikilink, a callout or a task list looks the
 * same on a board as it does in a note. Editing swaps this for a real Milkdown
 * instance, but only for the one card being edited.
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
