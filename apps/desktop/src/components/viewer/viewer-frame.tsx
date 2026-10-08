import { ViewerHeader } from './viewer-header';
import { cn } from '@/lib/utils';

type ViewerFrameProps = {
  path: string;
  find?: boolean;
  /** Extra controls for the header's left cell. */
  leading?: React.ReactNode;
  /** Floating panel, centred over the bottom of the content. */
  toolbar?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
} & Omit<React.ComponentProps<'div'>, 'children' | 'className'>;

/**
 * Header plus a content region that fills the rest of the tab.
 *
 * Unlike `FileEditor` the frame does not scroll: an image pans, a PDF scrolls
 * its own page column, and a video does neither. `min-h-0` is what lets the
 * content region actually shrink inside the flex column rather than pushing
 * the header off the top.
 */
export function ViewerFrame({
  path,
  find,
  leading,
  toolbar,
  className,
  children,
  ...props
}: ViewerFrameProps) {
  return (
    <div className='flex h-full w-full flex-col overflow-hidden' {...props}>
      <ViewerHeader path={path} find={find} leading={leading} />

      <div className={cn('relative min-h-0 flex-1', className)}>
        {children}

        {toolbar && (
          // `pointer-events-none` on the rail so the strip of empty space
          // beside the toolbar does not eat drags aimed at the content.
          <div className='pointer-events-none absolute inset-x-0 bottom-[calc(1rem+env(safe-area-inset-bottom))] z-20 flex justify-center px-4'>
            {toolbar}
          </div>
        )}
      </div>
    </div>
  );
}
