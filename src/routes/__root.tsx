// src/routes/__root.tsx
import { useEffect, useState } from 'react';
import { createRootRoute, Outlet } from '@tanstack/react-router';
import { ThemeProvider } from '../components/theme-provider';
import {
  SidebarInset,
  SidebarProvider,
} from '@/components/ui/resizable-sidebar';
import { AppSidebar } from '@/components/app-sidebar';
import TitleBar from '@/components/title-bar';
import { useWorkspaceUIStore } from '@/lib/stores/workspace-ui-store';
import { useWorkspace } from '@/hooks/use-workspace';
import { registerCommand } from '@/lib/commands';
import { useKeymapStore } from '@/lib/stores/keymap';
import { useGlobalKeybinds } from '@/hooks/use-global-keybinds';

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

    useEffect(() => {
      useWorkspace.getState().init();
      return useWorkspaceUIStore.persist.onFinishHydration(() =>
        setHydrated(true),
      );
    }, []);

    useEffect(() => {
      // Register what each command id actually does, once.
      registerCommand('file.new', () => console.log("file.new"));
      registerCommand('edit.bold', () => console.log("edit.bold"));
      registerCommand('view.toggle_sidebar', () => console.log("view.toggle_sidebar"));

      // Fetch the resolved registry + subscribe to keymap-changed.
      void useKeymapStore.getState().init();
    }, []);

    // Registers/re-registers tinykeys bindings whenever the registry updates.
    useGlobalKeybinds();

    return (
      <ThemeProvider defaultTheme='dark' storageKey='vite-ui-theme'>
        <div className='h-screen bg-background text-foreground flex flex-col overflow-hidden'>
          <SidebarProvider
            key={hydrated ? 'hydrated' : 'initial'}
            open={!sidebarCollapsed}
            onOpenChange={(open) => setSidebarCollapsed(!open)}
            defaultWidth={`${sidebarWidth}px`}
            onWidthChange={setSidebarWidth}
            className='flex-col'
          >
            <TitleBar />
            <div className='flex flex-1 min-h-0 relative w-full max-w-full'>
              <AppSidebar />
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
