import { useEffect, useMemo, useState } from 'react';
import { Check } from 'lucide-react';

import { useLayout } from '@/hooks/use-layout';
import { resolveCanvasColor } from '@/lib/canvas/color';
import { loadEmbedSource, subscribeToEmbedSources } from '@/lib/embed/source';
import { stripPresetExtension } from '@/lib/stores/entry-input';
import { parseBoard, plainTitle } from '@/lib/task-board/parse';
import { basename } from '@/lib/wikilink/target';
import '@/styles/task-board.css';

/**
 * A board embedded in a note (`![[Groceries]]`): its columns and card titles,
 * read-only and live, opening the board on a click.
 */
export function BoardPreview({ path }: { path: string }) {
  const [text, setText] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const read = () => {
      void loadEmbedSource(path).then((next) => {
        if (!cancelled) setText(next);
      });
    };
    read();
    const unsubscribe = subscribeToEmbedSources(read);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [path]);

  const board = useMemo(() => (text === null ? null : parseBoard(text)), [text]);
  const name = stripPresetExtension(basename(path)).name;

  return (
    <button
      type='button'
      data-not-typeset
      className='board-preview'
      onClick={() => useLayout.getState().openFile(path, name)}
    >
      <span className='board-preview-title'>{board?.title ?? name}</span>
      <span className='board-preview-columns'>
        {board?.columns.map((column, c) => (
          <span
            key={c}
            className='board-preview-column'
            data-tinted={column.color ? '' : undefined}
            style={{ '--column-color': resolveCanvasColor(column.color ?? undefined) ?? undefined } as React.CSSProperties}
          >
            <span className='board-preview-name'>
              {column.name || 'Untitled'}
              <span className='board-column-count'>{column.cards.length}</span>
            </span>
            {column.cards.map((card, i) => (
              <span key={i} className='board-preview-card' data-checked={card.checked || undefined}>
                <span className='board-check'>{card.checked && <Check className='size-2.5' strokeWidth={3} />}</span>
                <span className='min-w-0 truncate'>{plainTitle(card.title)}</span>
              </span>
            ))}
          </span>
        ))}
      </span>
    </button>
  );
}
