import { useState } from 'react';
import { Check, RotateCcw, Shuffle } from 'lucide-react';

import { Button } from '@sunstead/ui/components/button';
import { Input } from '@sunstead/ui/components/input';
import { normalizeHex, textColorFor } from '@/lib/workspace/color';
import { cn } from '@/lib/utils';

/**
 * A color picker's body: swatches, any hex, and optionally Shuffle and a
 * reset (`onChoose(null)`). `onChoose` returns an error to show, if saving
 * failed. Mount it afresh to start the hex field over.
 */
export function ColorPickerPanel({
  color,
  swatches,
  onChoose,
  shuffle,
  reset,
}: {
  /** The color now; none shows an empty hex field. */
  color: string | null;
  swatches: readonly string[];
  onChoose: (color: string | null) => Promise<string | null> | void;
  shuffle?: () => string;
  /** The reset button's title, and whether there's anything to reset. */
  reset?: { title: string; enabled: boolean };
}) {
  const [draft, setDraft] = useState(color ?? '');
  const [error, setError] = useState<string | null>(null);
  const valid = normalizeHex(draft);

  const choose = async (next: string | null) => {
    setError(null);
    if (next) setDraft(next);
    const failed = await onChoose(next);
    if (failed) setError(failed);
  };

  return (
    <div className='flex flex-col gap-4'>
      <div className='grid grid-cols-6 gap-2'>
        {swatches.map((swatch) => (
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
          placeholder='#rrggbb'
          spellCheck={false}
          className={cn('h-8 flex-1 font-mono text-xs', draft !== '' && !valid && 'border-destructive')}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => valid && valid !== color && void choose(valid)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && valid) void choose(valid);
          }}
        />
        {shuffle && (
          <Button variant='ghost' size='icon-sm' title='Shuffle' onClick={() => void choose(shuffle())}>
            <Shuffle />
          </Button>
        )}
        {reset && (
          <Button variant='ghost' size='icon-sm' title={reset.title} disabled={!reset.enabled} onClick={() => void choose(null)}>
            <RotateCcw />
          </Button>
        )}
      </div>
      {error && <p className='text-xs text-destructive select-text'>{error}</p>}
    </div>
  );
}
