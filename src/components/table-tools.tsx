import {
  addColumnAfter,
  addColumnBefore,
  addRowAfter,
  addRowBefore,
  deleteColumn,
  deleteRow,
  deleteTable,
} from '@milkdown/kit/prose/tables';
import type { Command } from '@milkdown/kit/prose/state';
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ArrowDownToLine,
  ArrowLeftToLine,
  ArrowRightToLine,
  ArrowUpToLine,
  Trash2,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { setColumnAlignment, type ColumnAlignment } from '@/lib/table';
import { useTableTools, type TableTarget } from '@/lib/stores/table-tools';

/**
 * Row and column controls for the table the caret is in.
 *
 * A floating panel rather than handles drawn into the table: ProseMirror owns
 * the table DOM through `prosemirror-tables`, and decorating it with controls
 * fights both its column-resizing and its cell selection.
 */
export function TableTools() {
  const target = useTableTools((s) => s.target);
  if (!target) return null;

  return <TableToolsPanel target={target} />;
}

function TableToolsPanel({ target }: { target: TableTarget }) {
  const { view } = target;

  const run = (command: Command) => () => {
    command(view.state, view.dispatch, view);
    view.focus();
  };

  const align = (value: ColumnAlignment) => () => {
    setColumnAlignment(view, value);
    view.focus();
  };

  // Read from the store rather than recomputed here: the store is what
  // actually changes (and re-renders this component) after an align click.
  const active = target.alignment;

  return (
    <div
      className='fixed z-40 flex w-max items-center gap-0.5 rounded-xl border bg-popover p-1 shadow-lg backdrop-blur-xl backdrop-saturate-150 animate-in fade-in-0 slide-in-from-bottom-1'
      style={{ top: target.rect.top - 42, left: target.rect.left }}
    >
      <Button size='icon-sm' variant='ghost' title='Row above' onClick={run(addRowBefore)}>
        <ArrowUpToLine />
      </Button>
      <Button size='icon-sm' variant='ghost' title='Row below' onClick={run(addRowAfter)}>
        <ArrowDownToLine />
      </Button>
      <Button size='icon-sm' variant='ghost' title='Delete row' onClick={run(deleteRow)}>
        <Trash2 />
      </Button>

      <Separator orientation='vertical' className='mx-1 h-5 self-center!' />

      <Button size='icon-sm' variant='ghost' title='Column left' onClick={run(addColumnBefore)}>
        <ArrowLeftToLine />
      </Button>
      <Button size='icon-sm' variant='ghost' title='Column right' onClick={run(addColumnAfter)}>
        <ArrowRightToLine />
      </Button>
      <Button size='icon-sm' variant='ghost' title='Delete column' onClick={run(deleteColumn)}>
        <Trash2 className='rotate-90' />
      </Button>

      <Separator orientation='vertical' className='mx-1 h-5 self-center!' />

      {(
        [
          ['left', AlignLeft],
          ['center', AlignCenter],
          ['right', AlignRight],
        ] as const
      ).map(([value, Icon]) => (
        <Button
          key={value}
          size='icon-sm'
          variant={active === value ? 'default' : 'ghost'}
          title={`Align ${value}`}
          onClick={align(value)}
        >
          <Icon />
        </Button>
      ))}

      <Separator orientation='vertical' className='mx-1 h-5 self-center!' />

      <Button
        size='icon-sm'
        variant='ghost'
        title='Delete table'
        onClick={run(deleteTable)}
        className='text-destructive'
      >
        <Trash2 />
      </Button>
    </div>
  );
}
