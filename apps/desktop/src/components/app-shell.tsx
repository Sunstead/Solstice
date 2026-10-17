import { SidebarInset, useSidebar } from '@sunstead/ui/components/resizable-sidebar';
import { AppSidebar } from '@/components/app-sidebar';
import { TitleBarShell } from '@/components/title-bar';
import { cn } from '@/lib/utils';

/**
 * The title bar and sidebar column beside the editor area. A phone has
 * neither: the editor area is the whole app there (PhoneShell).
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const { isMobile, state } = useSidebar();
  return (
    <div className='flex flex-1 min-h-0 relative w-full max-w-full'>
      {!isMobile && (
        <div className='h-full flex flex-col'>
          <TitleBarShell />

          <div className='relative flex-1 min-h-0'>
            <AppSidebar />
          </div>
        </div>
      )}
      {/* With Islands, the editor's panes sit on the window's colour
          (`islands.css`), their tabs in the title bar's row: no gap on top.
          Collapsed, the rail's own margin is the gap, so the panes start
          where the explorer does when it's open. */}
      <SidebarInset
        className={cn(
          'islands:bg-sidebar islands:p-(--island-gap) islands:pt-0 islands:transition-[padding] islands:duration-200 islands:ease-in-out',
          // Touch-first: the panes run to the screen's right and bottom
          // edges (`islands.css` squares their corners there).
          'islands:touch:pr-0 islands:touch:pb-0',
          state === 'collapsed' && 'islands:pl-0',
        )}
      >
        {children}
      </SidebarInset>
    </div>
  );
}
