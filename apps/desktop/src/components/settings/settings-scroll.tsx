import type { ReactNode } from 'react';
import { ScrollArea } from '@sunstead/ui/components/scroll-area';

/**
 * The settings dialog's scrolling body. Keyed by what it shows, so each page
 * starts at the top with a scrollbar measured for its own content: a reused
 * viewport kept the last page's scroll position and thumb.
 */
export function SettingsScroll({ page, children }: { page: string; children: ReactNode }) {
  return (
    <ScrollArea key={page} className='h-full'>
      {children}
    </ScrollArea>
  );
}
