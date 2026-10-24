import { useEffect, useRef } from 'react';

import { KEYBOARD_BAR_PX, useKeyboard, useKeyboardBarShown } from '@/lib/keyboard';
import { cn } from '@/lib/utils';

const WIDTH = 240;
const MAX_HEIGHT = 288;
const GAP = 6;

/** Where a menu hangs from, in viewport coordinates. */
export type CaretRect = { left: number; top: number; bottom: number };

/**
 * A list under a spot in the text (or over it, near the bottom), driven from
 * the editor's keys: the `/` menu and the `[[` suggestions.
 */
export function CaretMenu<T>({
  label,
  at,
  items,
  index,
  itemKey,
  render,
  onHover,
  onChoose,
  width = WIDTH,
}: {
  label: string;
  at: CaretRect;
  items: readonly T[];
  index: number;
  itemKey: (item: T) => string;
  render: (item: T) => React.ReactNode;
  onHover: (index: number) => void;
  onChoose: (item: T) => void;
  width?: number;
}) {
  const list = useRef<HTMLDivElement>(null);
  const inset = useKeyboard((s) => s.inset);
  const bar = useKeyboardBarShown();

  useEffect(() => {
    list.current?.querySelector('[data-active]')?.scrollIntoView({ block: 'nearest' });
  }, [index]);

  // `fixed` is placed in the layout viewport, but what can be seen ends at
  // the on-screen keyboard and the bar on it.
  const room = document.documentElement.clientHeight;
  const covered = inset + (bar ? KEYBOARD_BAR_PX : 0);
  const visible = Math.min(room - covered, window.visualViewport?.height ?? room);
  const below = visible - at.bottom - GAP;
  const above = at.top - GAP;
  const flip = below < Math.min(MAX_HEIGHT, 160) && above > below;
  const left = Math.max(8, Math.min(at.left, document.documentElement.clientWidth - width - 8));

  return (
    <div
      ref={list}
      role='listbox'
      aria-label={label}
      className='fixed z-50 overflow-y-auto rounded-lg border bg-popover p-1 text-popover-foreground shadow-md'
      style={{
        left,
        width,
        maxHeight: Math.min(MAX_HEIGHT, flip ? above : below),
        ...(flip ? { bottom: room - at.top + GAP } : { top: at.bottom + GAP }),
      }}
      // Clicks mustn't take focus from the editor.
      onPointerDown={(e) => e.preventDefault()}
      onMouseDown={(e) => e.preventDefault()}
    >
      {items.map((item, i) => (
        <button
          key={itemKey(item)}
          type='button'
          role='option'
          aria-selected={i === index}
          data-active={i === index ? '' : undefined}
          className={cn(
            'flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm pointer-coarse:py-2.5',
            i === index && 'bg-accent text-accent-foreground',
          )}
          onMouseEnter={() => onHover(i)}
          onClick={() => onChoose(item)}
        >
          {render(item)}
        </button>
      ))}
    </div>
  );
}
