import { cn } from '@/lib/utils';

/**
 * The floating control panel a viewer hangs over its content.
 *
 * Same shell as `FindBar` / `TableTools` / `LinkEditor` -- one panel look for
 * every transient control surface in the app -- entering from the bottom
 * because that is where this one lives.
 *
 * Controls float rather than sitting in the header so they never steal width
 * from the breadcrumb in a narrow split pane, and so a viewer can fade them
 * out over playing video without the header jumping.
 */
export function ViewerToolbar({
  className,
  children,
  ...props
}: React.ComponentProps<'div'>) {
  return (
    <div
      className={cn(
        'pointer-events-auto flex w-max max-w-full items-center gap-0.5 rounded-xl border bg-popover p-1 shadow-lg backdrop-blur-xl backdrop-saturate-150 animate-in fade-in-0 slide-in-from-bottom-1',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

/** Hairline between groups of controls inside one toolbar. */
export function ViewerToolbarSeparator() {
  return <div className='mx-1 h-5 w-px shrink-0 bg-border' aria-hidden />;
}

/** Numeric readout, sized to stop the toolbar twitching as digits change. */
export function ViewerToolbarReadout({
  className,
  children,
  ...props
}: React.ComponentProps<'span'>) {
  return (
    <span
      className={cn(
        'px-1 text-xs tabular-nums text-muted-foreground select-none',
        className,
      )}
      {...props}
    >
      {children}
    </span>
  );
}
