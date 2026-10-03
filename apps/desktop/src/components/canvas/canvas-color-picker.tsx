import { Ban } from 'lucide-react';

import { CANVAS_PRESETS } from '@/lib/canvas/color';
import type { CanvasColor } from '@/lib/canvas/types';
import { cn } from '@/lib/utils';

/**
 * The six colours JSON Canvas defines, plus a way back to none. Not a setting:
 * a card's colour is document data living in the `.canvas` file.
 */
export function CanvasColorPicker({
  value,
  onPick,
  className,
}: {
  value?: CanvasColor;
  onPick: (color: CanvasColor | undefined) => void;
  className?: string;
}) {
  return (
    <div className={cn('flex items-center gap-1 px-1 py-0.5', className)}>
      <button
        type='button'
        title='No colour'
        aria-label='No colour'
        onClick={() => onPick(undefined)}
        className={cn(
          'flex size-5 items-center justify-center rounded-full border text-muted-foreground',
          value === undefined && 'ring-2 ring-ring ring-offset-1 ring-offset-popover',
        )}
      >
        <Ban className='size-3' />
      </button>

      {CANVAS_PRESETS.map((preset) => (
        <button
          key={preset.value}
          type='button'
          title={preset.label}
          aria-label={preset.label}
          onClick={() => onPick(preset.value)}
          className={cn(
            'size-5 rounded-full border border-black/10 dark:border-white/15',
            value === preset.value &&
              'ring-2 ring-ring ring-offset-1 ring-offset-popover',
          )}
          style={{ backgroundColor: `var(--canvas-color-${preset.value})` }}
        />
      ))}
    </div>
  );
}
