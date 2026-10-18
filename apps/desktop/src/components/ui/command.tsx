import type { ComponentProps } from 'react';

import { CommandDialog as PackageCommandDialog } from '@sunstead/ui/components/command';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { touchFirst } from '@/lib/backend/platform';
import { cn } from '@/lib/utils';

// eslint-disable-next-line react-refresh/only-export-components -- a plain re-export of the package's components
export * from '@sunstead/ui/components/command';

/** The package's command dialog on this project's `DialogContent`, so a touch screen gets its pane. */
export function CommandDialog({
  title = 'Command Palette',
  description = 'Search for a command to run...',
  children,
  className,
  showCloseButton = false,
  ...props
}: ComponentProps<typeof PackageCommandDialog>) {
  return (
    <Dialog {...props}>
      <DialogHeader className='sr-only'>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
      </DialogHeader>
      <DialogContent
        align='top'
        className={cn(touchFirst ? '' : 'top-1/3 translate-y-0', 'overflow-hidden rounded-xl! p-0', className)}
        showCloseButton={showCloseButton}
      >
        {children}
      </DialogContent>
    </Dialog>
  );
}
