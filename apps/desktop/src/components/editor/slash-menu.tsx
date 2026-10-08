import { useEffect, useRef } from 'react';

import { useSlashMenu } from '@/lib/slash';
import { cn } from '@/lib/utils';

const WIDTH = 240;
const MAX_HEIGHT = 288;
const GAP = 6;

/** The `/` menu, under the slash (or over it, near the bottom). */
export function SlashMenu() {
  const { items, index, at, choose } = useSlashMenu();
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => {
    list.current?.querySelector('[data-active]')?.scrollIntoView({ block: 'nearest' });
  }, [index]);

  if (!at || !choose || items.length === 0) return null;

  const room = document.documentElement.clientHeight;
  const below = room - at.bottom - GAP;
  const above = at.top - GAP;
  const flip = below < Math.min(MAX_HEIGHT, 160) && above > below;
  const left = Math.max(8, Math.min(at.left, document.documentElement.clientWidth - WIDTH - 8));

  return (
    <div
      ref={list}
      role='listbox'
      aria-label='Insert'
      className='fixed z-50 overflow-y-auto rounded-lg border bg-popover p-1 text-popover-foreground shadow-md'
      style={{
        left,
        width: WIDTH,
        maxHeight: Math.min(MAX_HEIGHT, flip ? above : below),
        ...(flip ? { bottom: room - at.top + GAP } : { top: at.bottom + GAP }),
      }}
      // Clicks mustn't take focus from the editor.
      onPointerDown={(e) => e.preventDefault()}
      onMouseDown={(e) => e.preventDefault()}
    >
      {items.map((item, i) => (
        <button
          key={item.label}
          type='button'
          role='option'
          aria-selected={i === index}
          data-active={i === index ? '' : undefined}
          className={cn(
            'flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm pointer-coarse:py-2.5',
            i === index && 'bg-accent text-accent-foreground',
          )}
          onMouseEnter={() => useSlashMenu.setState({ index: i })}
          onClick={() => choose(item)}
        >
          <item.icon className='size-4 shrink-0 text-muted-foreground' />
          {item.label}
        </button>
      ))}
    </div>
  );
}
