import { Slider } from '@sunstead/ui/components/slider';
import { presetWidths, type ToolSlot } from '@/lib/ink/toolbox';
import { inkDispatch } from '@/lib/stores/ink-tools';
import { cn } from '@/lib/utils';

/** A tool's width (five presets) and opacity, or an eraser's kind: what tapping the slot in hand opens. */
export function ToolAttributes({ slot }: { slot: ToolSlot }) {
  if (slot.kind === 'lasso') return <p className='text-sm text-muted-foreground'>The lasso has no settings.</p>;
  const widths = presetWidths(slot.kind);
  const largest = widths[widths.length - 1];
  return (
    <div className='flex flex-col gap-3'>
      {slot.kind === 'eraser' && (
        <div className='grid grid-cols-2 gap-1 rounded-md bg-muted p-0.5 text-sm'>
          {(['vector', 'bitmap'] as const).map((mode) => (
            <button
              key={mode}
              type='button'
              aria-pressed={slot.eraser === mode}
              className={cn('rounded-sm px-2 py-1', slot.eraser === mode && 'bg-background shadow-sm')}
              onClick={() => inkDispatch({ type: 'setEraserMode', mode })}
            >
              {mode === 'vector' ? 'Object' : 'Pixel'}
            </button>
          ))}
        </div>
      )}
      {(slot.kind !== 'eraser' || slot.eraser === 'bitmap') && (
        <div className='flex items-center justify-between gap-1' role='radiogroup' aria-label='Width'>
          {widths.map((width) => (
            <button
              key={width}
              type='button'
              role='radio'
              aria-checked={slot.width === width}
              aria-label={`Width ${width}`}
              className={cn(
                'grid size-9 place-items-center rounded-full touch:size-11',
                slot.width === width ? 'bg-accent ring-1 ring-foreground/20' : 'hover:bg-accent/60',
              )}
              onClick={() => inkDispatch({ type: 'setWidth', width })}
            >
              <span
                className='rounded-full bg-foreground'
                style={{ width: 4 + (width / largest) * 18, height: 4 + (width / largest) * 18 }}
              />
            </button>
          ))}
        </div>
      )}
      {slot.kind !== 'eraser' && (
        <label className='flex flex-col gap-2 text-sm'>
          <span className='flex justify-between text-muted-foreground'>
            Opacity <span>{Math.round(slot.opacity * 100)}%</span>
          </span>
          <Slider
            min={10}
            max={100}
            step={5}
            value={Math.round(slot.opacity * 100)}
            onValueChange={(value) => inkDispatch({ type: 'setOpacity', opacity: (value as number) / 100 })}
          />
        </label>
      )}
    </div>
  );
}
