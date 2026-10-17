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
import { useOverSurface } from '@/lib/native-surfaces';

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const { open, setOpen, toggleSidebar, isMobile, setOpenMobile } = useSidebar();
  // Half the rail lies over the editor: over a PDF or a drawing, its
  // touches would otherwise go to the native view under the webview.
  const overSurface = useOverSurface();

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
        // Clipped inside, not on the container: the rail hangs half outside
        // it, and a clipped half takes no touch.
        '*:data-[sidebar=sidebar]:flex-row *:data-[sidebar=sidebar]:overflow-hidden',
        // Islands: no edge between the sidebar and the editor, only the gap.
        'islands:border-r-0!',
        isMobile &&
          'data-[side=left]:w-(--sidebar-width) data-[side=left]:max-w-none pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)]',
      )}
      {...props}
    >
      <Sidebar
        collapsible='none'
        className='chrome w-(--sidebar-width-icon)! min-w-(--sidebar-width-icon) border-r islands:border-r-0'
      >
        <SidebarContent>
          <SidebarGroup className='p-0'>
            {/* With Islands the active view is a filled square, inset from the edges. */}
            <SidebarGroupContent className='px-1.5 md:px-0 islands:md:px-1.5 islands:pt-1'>
              <SidebarMenu className='gap-0 islands:gap-1'>
                {primaryViews.map((view) => (
                  <SidebarMenuItem key={view.id}>
                    <button
                      type='button'
                      data-active={view.id === activePrimaryView && (open || isMobile)}
                      onClick={() => handleSelect(view.id)}
                      className='data-[active=true]:shadow-[inset_2px_0_0_0_var(--color-primary)] flex aspect-square w-full items-center justify-center text-xs font-medium text-muted-foreground hover:bg-(--chrome-hover) hover:text-foreground data-[active=true]:text-foreground islands:rounded-md islands:data-[active=true]:shadow-none islands:data-[active=true]:bg-sidebar-accent islands:data-[active=true]:hover:bg-sidebar-accent'
                    >
                      <view.icon className='size-5 touch:size-6' />
                    </button>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter className='p-0'>
          <SidebarGroup className='p-0'>
            <SidebarGroupContent className='px-1.5 md:px-0 text-muted-foreground'>
              <SidebarMenu className='gap-2 items-center py-2'>
                <SidebarMenuItem>
                  <AccountButton />
                </SidebarMenuItem>
                <SidebarMenuItem>
                  {/* The dialog itself lives at the root, so the command,
                      the native menu and this button all drive one instance. */}
                  <Button
                    variant='ghost'
                    size='icon'
                    className='size-10 touch:size-12'
                    onClick={() => {
                      setOpenMobile(false);
                      openSettings();
                    }}
                  >
                    <Settings className='size-5 touch:size-6' />
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
        className={cn(
          'flex flex-1 w-[calc(var(--sidebar-width)-var(--sidebar-width-icon))]! min-w-[calc(var(--sidebar-width)-var(--sidebar-width-icon))]',
          // An island: the notes' own colour, with the rail and the title
          // bar its rim on two sides and the gap on the others. Stretched,
          // not full height, so the gap below it fits in the window and it
          // ends level with the editor's panes.
          !isMobile && 'island-panel islands:h-auto islands:mb-(--island-gap) islands:rounded-(--island-radius) islands:bg-background island-borders:border island-borders:border-(--color-tab-outline)',
        )}
      >
        {ActiveSidebarContent && <ActiveSidebarContent />}
        <SidebarFooter className='border-t islands:border-t-0 island-borders:border-t'>
          <WorkspaceSwitcher />
        </SidebarFooter>
      </Sidebar>
      <SidebarRail ref={overSurface} />
    </Sidebar>
  );
}
