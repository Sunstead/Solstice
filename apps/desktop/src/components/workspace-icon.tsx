import { textColorFor } from '@/lib/workspace/color';
import { workspaceInitials } from '@/lib/workspace/initials';
import { cn } from '@/lib/utils';

const SIZES = {
  sm: 'size-4 text-[8px]',
  md: 'size-5 text-[10px]',
  lg: 'size-7 text-xs',
  xl: 'size-10 text-base',
} as const;

/**
 * A workspace at a glance, as in JetBrains IDEs: its letters (School → S,
 * Business Meetings → BM) on its color, in a rounded square.
 */
export function WorkspaceIcon({
  name,
  color,
  size = 'md',
  className,
}: {
  name: string;
  /** `#rrggbb`: `workspaceColor` gives the picked one or the name's. */
  color: string;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-[28%] leading-none font-semibold tracking-tight select-none',
        // Keeps a pale color's edge on a pale background.
        'shadow-[inset_0_0_0_1px_rgb(0_0_0/0.08)]',
        SIZES[size],
        className,
      )}
      style={{ backgroundColor: color, color: textColorFor(color) }}
    >
      {workspaceInitials(name)}
    </span>
  );
}
