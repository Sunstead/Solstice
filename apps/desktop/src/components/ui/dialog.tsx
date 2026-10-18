import type { ComponentProps } from 'react';
import { XIcon } from 'lucide-react';

import { Button } from '@sunstead/ui/components/button';
import {
  DialogClose,
  DialogContent as PackageDialogContent,
  DialogOverlay,
  DialogPortal,
} from '@sunstead/ui/components/dialog';
import { touchFirst } from '@/lib/backend/platform';
import { cn } from '@/lib/utils';

import { Pane, type PaneAlign } from './touch-pane';

export {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
} from '@sunstead/ui/components/dialog';

/**
 * `@sunstead/ui`'s dialog, except on a touch screen, where it is a pane
 * (`touch-pane.tsx`): a scroll view the card is pulled away in, so a swipe
 * down is the system's own. Elsewhere it is the package's, untouched.
 */
export function DialogContent({
  className,
  children,
  showCloseButton = true,
  align = 'center',
  ...props
}: ComponentProps<typeof PackageDialogContent> & { align?: PaneAlign }) {
  if (!touchFirst) {
    return (
      <PackageDialogContent className={className} showCloseButton={showCloseButton} {...props}>
        {children}
      </PackageDialogContent>
    );
  }
  return (
    <DialogPortal>
      <DialogOverlay />
      <Pane
        slot='dialog-content'
        closeSlot='dialog-close'
        align={align}
        popupProps={props}
        cardClassName={cn(
          'grid w-full max-w-[calc(100%-2rem)] gap-6 rounded-xl bg-popover p-6 text-sm text-popover-foreground ring-1 ring-foreground/10 outline-none sm:max-w-md',
          className,
        )}
      >
        {children}
        {showCloseButton && (
          <DialogClose render={<Button variant='ghost' className='absolute top-4 right-4' size='icon-sm' />}>
            <XIcon />
            <span className='sr-only'>Close</span>
          </DialogClose>
        )}
      </Pane>
    </DialogPortal>
  );
}
