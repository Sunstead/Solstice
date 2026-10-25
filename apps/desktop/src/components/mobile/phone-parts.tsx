import type { ComponentType, ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

import { WindowControls } from '@/components/window-controls';
import { useIsFullscreen } from '@/hooks/use-fullscreen';
import { useIsMac } from '@/hooks/use-platform';
import { can } from '@/lib/backend/platform';
import { useScrollEdge } from '@/lib/scroll-edge';
import { cn } from '@/lib/utils';

/**
 * A phone page's top bar: the page's own colour, no border, with a blurred
 * fade below once content scrolls under it (`useScrollEdge`). `large` is a
 * tab's root, whose title is large until the list scrolls. In a desktop
 * window that narrow it's also the title bar: a drag region, clear of the
 * traffic lights, with window controls.
 */
export function PhoneHeader({
  children,
  large = false,
  className,
}: {
  children: ReactNode;
  large?: boolean;
  className?: string;
}) {
  const isMac = useIsMac();
  const isFullscreen = useIsFullscreen();
  const edge = useScrollEdge('top');
  return (
    <header
      ref={edge}
      data-tauri-drag-region
      data-large={large || undefined}
      className={cn('phone-bar flex shrink-0 items-center gap-1 bg-background px-1.5', large ? 'h-14' : 'h-12', className)}
    >
      {/* The traffic lights sit over the top-left corner on macOS. */}
      {can.windowChrome && isMac && !isFullscreen && <span data-tauri-drag-region className='w-16 shrink-0' />}
      {children}
      {can.windowChrome && !isMac && <WindowControls />}
    </header>
  );
}

/** A page's title in its header; in a `large` one, large until the page scrolls. */
export function PhoneTitle({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <h1 data-tauri-drag-region className={cn('phone-title min-w-0 flex-1 truncate px-1.5 text-base font-semibold', className)}>
      {children}
    </h1>
  );
}

/**
 * A pushed page's bar, as UIKit's: back on the left carrying the previous
 * page's name, the title centred and semibold, and buttons on the right.
 * The two sides share the room left over equally, so the title stays in the
 * middle.
 */
export function PushedHeader({
  back,
  onBack,
  title,
  actions,
}: {
  back: string;
  onBack: () => void;
  title: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <PhoneHeader className='h-11 gap-0'>
      <div className='flex min-w-0 flex-1 basis-0'>
        <PhoneBack label={back} onClick={onBack} />
      </div>
      <PhoneTitle className='max-w-[55%] flex-none px-1 text-center text-[17px]'>{title}</PhoneTitle>
      <div className='flex min-w-0 flex-1 basis-0 items-center justify-end gap-0.5'>{actions}</div>
    </PhoneHeader>
  );
}

/** Back, named for where it goes ("‹ Files"), tinted. */
export function PhoneBack({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type='button'
      onClick={onClick}
      className='phone-tint flex h-11 min-w-11 items-center pr-2 text-[17px] active:opacity-40'
    >
      <ChevronLeft className='size-7 shrink-0' strokeWidth={2.25} />
      <span className='-ml-0.5 truncate'>{label}</span>
    </button>
  );
}

/**
 * Rows in a list, iOS-style: a rounded group with no outline, its rows
 * divided by hairlines inset past their icons (`.phone-rows`, app.css).
 * `sheet` is a group in a sheet, which is already on the card's colour.
 */
export function RowGroup({
  title,
  tone = 'page',
  children,
}: {
  title?: ReactNode;
  tone?: 'page' | 'sheet';
  children: ReactNode;
}) {
  return (
    <section className='flex flex-col gap-1.5'>
      {title && <h2 className='px-3 text-[13px] text-muted-foreground'>{title}</h2>}
      <div className={cn('phone-rows flex flex-col overflow-hidden rounded-xl', tone === 'page' ? 'bg-card' : 'bg-muted')}>
        {children}
      </div>
    </section>
  );
}

/**
 * One row: an icon (or anything else `leading`, like a workspace's), a label,
 * and what's on the right (a chevron when it goes somewhere).
 */
export function Row({
  icon: Icon,
  leading,
  label,
  detail,
  chevron = false,
  destructive = false,
  disabled = false,
  onClick,
}: {
  icon?: ComponentType<{ className?: string }>;
  leading?: ReactNode;
  label: ReactNode;
  detail?: ReactNode;
  chevron?: boolean;
  destructive?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type='button'
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'flex min-h-11 w-full items-center gap-3 px-3 text-left text-[17px] active:bg-accent disabled:opacity-40',
        destructive && 'text-destructive',
      )}
    >
      {leading ?? (Icon && <Icon className={cn('size-5 shrink-0', !destructive && 'text-muted-foreground')} />)}
      <span className='min-w-0 flex-1 truncate'>{label}</span>
      {detail}
      {chevron && <ChevronRight className='size-4 shrink-0 text-muted-foreground' />}
    </button>
  );
}
