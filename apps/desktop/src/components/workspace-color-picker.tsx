import { useState, type ReactElement } from 'react';
import { Check, RotateCcw, Shuffle } from 'lucide-react';

import { Button } from '@sunstead/ui/components/button';
import { Input } from '@sunstead/ui/components/input';
import { Popover, PopoverContent, PopoverTrigger } from '@sunstead/ui/components/popover';
import { WORKSPACE_SWATCHES, normalizeHex, randomWorkspaceColor, textColorFor } from '@/lib/workspace/color';
import { cn } from '@/lib/utils';

/**
 * Picks a workspace's color: a swatch, Shuffle, or any hex. `onChange(null)`
 * goes back to the color from the name. `onChange` returns an error to show,
 * if saving failed.
 */
export function WorkspaceColorPicker({
  color,
  picked,
  onChange,
  trigger,
}: {
  /** What the icon shows now. */
  color: string;
  /** Whether that color was picked (Reset is only for those). */
  picked: boolean;
  onChange: (color: string | null) => Promise<string | null> | void;
  trigger: ReactElement;
}) {
  const [draft, setDraft] = useState(color);
  const [error, setError] = useState<string | null>(null);
  const valid = normalizeHex(draft);

  const choose = async (next: string | null) => {
    setError(null);
    if (next) setDraft(next);
    const failed = await onChange(next);
    if (failed) setError(failed);
  };

  return (
    <Popover onOpenChange={(open) => open && (setDraft(color), setError(null))}>
      <PopoverTrigger render={trigger} />
      <PopoverContent className='w-60 gap-3' align='start'>
        <div className='grid grid-cols-6 gap-1.5'>
          {WORKSPACE_SWATCHES.map((swatch) => (
            <button
              key={swatch}
              type='button'
              aria-label={`Color ${swatch}`}
              className='flex aspect-square items-center justify-center rounded-[28%] outline-offset-2 focus-visible:outline-2 focus-visible:outline-ring'
              style={{ backgroundColor: swatch, color: textColorFor(swatch) }}
              onClick={() => void choose(swatch)}
            >
              {swatch === color && <Check className='size-3.5' />}
            </button>
          ))}
        </div>
        <div className='flex items-center gap-1.5'>
          <Input
            aria-label='Hex color'
            value={draft}
            spellCheck={false}
            className={cn('h-8 flex-1 font-mono text-xs', !valid && 'border-destructive')}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => valid && valid !== color && void choose(valid)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && valid) void choose(valid);
            }}
          />
          <Button variant='ghost' size='icon-sm' title='Shuffle' onClick={() => void choose(randomWorkspaceColor())}>
            <Shuffle />
          </Button>
          <Button
            variant='ghost'
            size='icon-sm'
            title='Back to the color from the name'
            disabled={!picked}
            onClick={() => void choose(null)}
          >
            <RotateCcw />
          </Button>
        </div>
        {error && <p className='text-xs text-destructive select-text'>{error}</p>}
      </PopoverContent>
    </Popover>
  );
}
