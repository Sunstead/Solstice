'use client';

import * as React from 'react';
import { Settings } from 'lucide-react';

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from '@sunstead/ui/components/resizable-sidebar';
import { Button } from '@sunstead/ui/components/button';
import { primaryViews } from '@/lib/views/registry';
import { useWorkspaceUIStore } from '@/lib/stores/workspace-ui-store';
import { useEffect } from 'react';
import { registerCommand, unregisterCommand } from '@/lib/commands';
import { WorkspaceSwitcher } from './workspace-switcher';
import { useSettingsDialog } from '@/lib/stores/settings-dialog';
import { AccountButton } from './account-button';
import { cn } from '@/lib/utils';

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const { open, setOpen, toggleSidebar, isMobile, setOpenMobile } = useSidebar();

  const activePrimaryView = useWorkspaceUIStore((s) => s.activePrimaryView);
  const setActivePrimaryView = useWorkspaceUIStore(
    (s) => s.setActivePrimaryView,
  );
  const setSidebarCollapsed = useWorkspaceUIStore((s) => s.setSidebarCollapsed);
  const openSettings = useSettingsDialog((s) => s.openSettings);

  const activeView =
    primaryViews.find((v) => v.id === activePrimaryView) ?? primaryViews[0];
  const ActiveSidebarContent = activeView?.sidebarComponent;

  function handleSelect(id: string) {
    // In the drawer the panel is always showing: the rail only switches views.
    if (isMobile) {
      setActivePrimaryView(id);
      return;
    }
    if (id === activePrimaryView) {
      const next = !open;
      setOpen(next);
      setSidebarCollapsed(!next);
    } else {
      setActivePrimaryView(id);
      setOpen(true);
      setSidebarCollapsed(false);
    }
  }

  useEffect(() => {
    registerCommand('view.toggle_sidebar', toggleSidebar);
    return () => unregisterCommand('view.toggle_sidebar');
  }, [toggleSidebar]);

  return (
    <Sidebar
      // `rail`, not `icon`: the panel beside the rail keeps its layout while
      // the edge closes over it, instead of its rows switching to icon mode.
      collapsible='rail'
      mobileWidth='min(85vw, 20rem)'
      className={cn(
        'overflow-hidden *:data-[sidebar=sidebar]:flex-row',
        isMobile &&
          'data-[side=left]:w-(--sidebar-width) data-[side=left]:max-w-none pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)]',
      )}
      {...props}
    >
      <Sidebar
        collapsible='none'
        className='w-(--sidebar-width-icon)! min-w-(--sidebar-width-icon) border-r'
      >
        <SidebarContent>
          <SidebarGroup className='p-0'>
            <SidebarGroupContent className='px-1.5 md:px-0'>
              <SidebarMenu className='gap-0'>
                {primaryViews.map((view) => (
                  <SidebarMenuItem key={view.id}>
                    <button
                      type='button'
                      data-active={view.id === activePrimaryView && (open || isMobile)}
                      onClick={() => handleSelect(view.id)}
                      className='data-[active=true]:shadow-[inset_2px_0_0_0_var(--color-primary)] flex flex-col items-center gap-0.5 w-full h-full px-2 py-3 text-xs font-medium text-muted-foreground hover:text-foreground data-[active=true]:text-foreground'
                    >
                      <view.icon className='size-5' />
                    </button>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter className='p-0'>
          <SidebarGroup>
            <SidebarGroupContent className='px-1.5 md:px-0 text-muted-foreground'>
              <SidebarMenu className='gap-1 flex flex-col items-center'>
                <SidebarMenuItem>
                  <AccountButton />
                </SidebarMenuItem>
                <SidebarMenuItem>
                  {/* The dialog itself lives at the root, so the command,
                      the native menu and this button all drive one instance. */}
                  <Button
                    variant='ghost'
                    size='icon'
                    className='size-10'
                    onClick={() => {
                      setOpenMobile(false);
                      openSettings();
                    }}
                  >
                    <Settings className='size-5' />
                    <span className='sr-only'>Settings</span>
                  </Button>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarFooter>
      </Sidebar>

      <Sidebar
        collapsible='none'
        // Hidden from the keyboard and screen readers while the edge covers it.
        inert={!isMobile && !open}
        className='flex flex-1 w-[calc(var(--sidebar-width)-var(--sidebar-width-icon))]! min-w-[calc(var(--sidebar-width)-var(--sidebar-width-icon))]'
      >
        {ActiveSidebarContent && <ActiveSidebarContent />}
        <SidebarFooter className='border-t'>
          <WorkspaceSwitcher />
        </SidebarFooter>
      </Sidebar>
      <SidebarRail />
    </Sidebar>
  );
}
