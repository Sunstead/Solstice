import { useEffect, useState } from 'react';
import { createRootRoute, Outlet } from '@tanstack/react-router';
import { ThemeProvider } from '../components/theme-provider';
import {
  SidebarInset,
  SidebarProvider,
} from '@/components/ui/resizable-sidebar';
import { AppSidebar } from '@/components/app-sidebar';
import { TitleBarShell } from '@/components/title-bar';
import { useWorkspaceUIStore } from '@/lib/stores/workspace-ui-store';
import { useWorkspace } from '@/hooks/use-workspace';
import { registerCommand, runCommand } from '@/lib/commands';
import { useKeymapStore } from '@/lib/stores/keymap';
import { useGlobalKeybinds } from '@/hooks/use-global-keybinds';
import { useDevicePixelRatio } from '@/hooks/use-device-pixel-ratio';

export const Route = createRootRoute({
  component: () => {
    const sidebarCollapsed = useWorkspaceUIStore((s) => s.sidebarCollapsed);
    const setSidebarCollapsed = useWorkspaceUIStore(
      (s) => s.setSidebarCollapsed,
    );
    const sidebarWidth = useWorkspaceUIStore((s) => s.sidebarWidth);
    const setSidebarWidth = useWorkspaceUIStore((s) => s.setSidebarWidth);

    const [hydrated, setHydrated] = useState(
      useWorkspaceUIStore.persist.hasHydrated(),
    );

    const openFolder = useWorkspace((s) => s.openFolder);

    useDevicePixelRatio();

    useEffect(() => {
      useWorkspace.getState().init();
      return useWorkspaceUIStore.persist.onFinishHydration(() =>
        setHydrated(true),
      );
    }, []);

    useEffect(() => {
      // Register what each command id actually does, once.
      registerCommand('edit.bold', () => console.log('edit.bold'));
      registerCommand('view.toggle_sidebar', () =>
        console.log('view.toggle_sidebar'),
      );
      registerCommand('file.open_folder', () => openFolder());

      // Fetch the resolved registry + subscribe to keymap-changed.
      void useKeymapStore.getState().init();

      const preventDefault = (event: MouseEvent) => {
        event.preventDefault();
      };

      const handleMouseDown = (event: MouseEvent) => {
        if (event.button !== 3 && event.button !== 4) return;

        event.preventDefault();

        if (event.button === 3) runCommand('navigation.back');
        if (event.button === 4) runCommand('navigation.forward');
      };

      document.addEventListener('contextmenu', preventDefault);
      document.addEventListener('mousedown', handleMouseDown);

      return () => {
        document.removeEventListener('mousedown', handleMouseDown);
        document.removeEventListener('contextmenu', preventDefault);
      };
    }, []);

    // Registers/re-registers tinykeys bindings whenever the registry updates.
    useGlobalKeybinds();

    return (
      <ThemeProvider defaultTheme='dark' storageKey='vite-ui-theme'>
        <div className='h-screen bg-sidebar text-foreground flex flex-col overflow-hidden'>
          <SidebarProvider
            key={hydrated ? 'hydrated' : 'initial'}
            open={!sidebarCollapsed}
            onOpenChange={(open) => setSidebarCollapsed(!open)}
            defaultWidth={`${sidebarWidth}px`}
            onWidthChange={setSidebarWidth}
            className='flex-col'
          >
            <div className='flex flex-1 min-h-0 relative w-full max-w-full'>
              <div className='h-full flex flex-col'>
                <TitleBarShell />

                <div className='relative flex-1 min-h-0'>
                  <AppSidebar />
                </div>
              </div>
              <SidebarInset>
                <Outlet />
              </SidebarInset>
            </div>
          </SidebarProvider>
        </div>
      </ThemeProvider>
    );
  },
});
