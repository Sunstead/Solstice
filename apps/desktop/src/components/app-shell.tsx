import { SidebarInset, useSidebar } from '@sunstead/ui/components/resizable-sidebar';
import { AppSidebar } from '@/components/app-sidebar';
import { TitleBarShell } from '@/components/title-bar';

/**
 * The title bar and sidebar column beside the editor area. A phone has
 * neither: the editor area is the whole app there (PhoneShell).
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const { isMobile } = useSidebar();
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
      <SidebarInset>{children}</SidebarInset>
    </div>
  );
}
