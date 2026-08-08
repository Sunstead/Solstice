'use client';

import * as React from 'react';
import { Settings } from 'lucide-react';

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from '@/components/ui/resizable-sidebar';
import { ThemeToggle } from './theme-toggle';
import { Button } from './ui/button';
import { primaryViews } from '@/lib/views/registry';
import { useWorkspaceUIStore } from '@/lib/stores/workspace-ui-store';
import { useWorkspace } from '@/hooks/use-workspace';
import { useEffect } from 'react';
import { registerCommand, unregisterCommand } from '@/lib/commands';

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const { open, setOpen, toggleSidebar } = useSidebar();

  const activePrimaryView = useWorkspaceUIStore((s) => s.activePrimaryView);
  const setActivePrimaryView = useWorkspaceUIStore(
    (s) => s.setActivePrimaryView,
  );
  const setSidebarCollapsed = useWorkspaceUIStore((s) => s.setSidebarCollapsed);

  const activeView =
    primaryViews.find((v) => v.id === activePrimaryView) ?? primaryViews[0];
  const ActiveSidebarContent = activeView?.sidebarComponent;

  function handleSelect(id: string) {
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

  const openFolder = useWorkspace((s) => s.openFolder);

  return (
    <Sidebar
      collapsible='icon'
      className='overflow-hidden *:data-[sidebar=sidebar]:flex-row'
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
                      data-active={view.id === activePrimaryView}
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
                  <ThemeToggle />
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <Button variant='ghost' size='icon' className='size-10'>
                    <Settings className='size-5' />
                    <span className='sr-only'>Settings</span>
                  </Button>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <Button
                    variant='ghost'
                    size='icon'
                    className='size-10'
                    onClick={openFolder}
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
        className='hidden flex-1 md:flex w-[calc(var(--sidebar-width)-var(--sidebar-width-icon))]! min-w-[calc(var(--sidebar-width)-var(--sidebar-width-icon))]'
      >
        <SidebarHeader className='px-3 py-2 text-xs font-medium text-muted-foreground'>
          {activeView?.label}
        </SidebarHeader>
        <SidebarContent>
          {ActiveSidebarContent && <ActiveSidebarContent />}
        </SidebarContent>
      </Sidebar>
      <SidebarRail />
    </Sidebar>
  );
}
