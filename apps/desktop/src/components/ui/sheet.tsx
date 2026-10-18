import type { ComponentProps } from 'react';
import { XIcon } from 'lucide-react';

import { Button } from '@sunstead/ui/components/button';
import { Dialog as SheetPrimitive } from '@base-ui/react/dialog';
import { SheetClose, SheetContent as PackageSheetContent } from '@sunstead/ui/components/sheet';
import { touchFirst } from '@/lib/backend/platform';
import { cn } from '@/lib/utils';

import { Pane } from './touch-pane';

export {
  Sheet,
  SheetClose,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@sunstead/ui/components/sheet';

// The package keeps its portal and backdrop to itself; these are its own.
function SheetOverlay({ className, ...props }: SheetPrimitive.Backdrop.Props) {
  return (
    <SheetPrimitive.Backdrop
      data-slot='sheet-overlay'
      className={cn(
        'fixed inset-0 z-50 bg-black/10 transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0 supports-backdrop-filter:backdrop-blur-xs',
        className,
      )}
      {...props}
    />
  );
}

/**
 * `@sunstead/ui`'s sheet, except a bottom sheet on a touch screen, which is
 * a pane (`touch-pane.tsx`): pulled away by scrolling, as iOS's are. Sheets
 * from the sides, and every sheet elsewhere, are the package's.
 */
export function SheetContent({
  className,
  children,
  side = 'right',
  showCloseButton = true,
  keepMounted,
  ...props
}: ComponentProps<typeof PackageSheetContent>) {
  if (!touchFirst || side !== 'bottom') {
    return (
      <PackageSheetContent
        className={className}
        side={side}
        showCloseButton={showCloseButton}
        keepMounted={keepMounted}
        {...props}
      >
        {children}
      </PackageSheetContent>
    );
  }
  return (
    <SheetPrimitive.Portal data-slot='sheet-portal' keepMounted={keepMounted}>
      <SheetOverlay />
      <Pane
        slot='sheet-content'
        closeSlot='sheet-close'
        align='end'
        popupProps={props}
        cardClassName={cn(
          'flex w-full flex-col gap-4 border-t bg-popover bg-clip-padding text-sm text-popover-foreground shadow-lg',
          className,
        )}
      >
        {children}
        {showCloseButton && (
          <SheetClose render={<Button variant='ghost' className='absolute top-4 right-4' size='icon-sm' />}>
            <XIcon />
            <span className='sr-only'>Close</span>
          </SheetClose>
        )}
      </Pane>
    </SheetPrimitive.Portal>
  );
}
