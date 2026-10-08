import type { ComponentType, ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';

import { WindowControls } from '@/components/window-controls';
import { useIsFullscreen } from '@/hooks/use-fullscreen';
import { useIsMac } from '@/hooks/use-platform';
import { can } from '@/lib/backend/platform';
import { cn } from '@/lib/utils';

/** The height of a `PhoneHeader`, where a page's edge swipe starts below. */
export const HEADER_HEIGHT = 48;

/**
 * A phone page's top bar. In a desktop window that narrow it's also the
 * title bar: a drag region, clear of the traffic lights, with window controls.
 */
export function PhoneHeader({ children, className }: { children: ReactNode; className?: string }) {
  const isMac = useIsMac();
  const isFullscreen = useIsFullscreen();
  return (
    <header
      data-tauri-drag-region
      className={cn('flex h-12 shrink-0 items-center gap-1 border-b bg-sidebar px-1.5', className)}
    >
      {/* The traffic lights sit over the top-left corner on macOS. */}
      {can.windowChrome && isMac && !isFullscreen && <span data-tauri-drag-region className='w-16 shrink-0' />}
      {children}
      {can.windowChrome && !isMac && <WindowControls />}
    </header>
  );
}

/** A page's title in its header. */
export function PhoneTitle({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <h1 data-tauri-drag-region className={cn('min-w-0 flex-1 truncate px-1.5 text-base font-semibold', className)}>
      {children}
    </h1>
  );
}

/** Rows in a list, iOS-style: a rounded group, divided. */
export function RowGroup({ title, children }: { title?: ReactNode; children: ReactNode }) {
  return (
    <section className='flex flex-col gap-1.5'>
      {title && <h2 className='px-3 text-xs font-medium text-muted-foreground'>{title}</h2>}
      <div className='flex flex-col divide-y overflow-hidden rounded-xl border bg-card'>{children}</div>
    </section>
  );
}

/** One row: an icon, a label, and what's on the right (a chevron when it goes somewhere). */
export function Row({
  icon: Icon,
  label,
  detail,
  chevron = false,
  destructive = false,
  disabled = false,
  onClick,
}: {
  icon?: ComponentType<{ className?: string }>;
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
        'flex min-h-12 w-full items-center gap-3 px-3 text-left text-[15px] active:bg-accent disabled:opacity-40',
        destructive && 'text-destructive',
      )}
    >
      {Icon && <Icon className={cn('size-5 shrink-0', !destructive && 'text-muted-foreground')} />}
      <span className='min-w-0 flex-1 truncate'>{label}</span>
      {detail}
      {chevron && <ChevronRight className='size-4 shrink-0 text-muted-foreground' />}
    </button>
  );
}
