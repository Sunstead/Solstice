import { useEffect, useState } from 'react';
import { createRootRoute, Outlet } from '@tanstack/react-router';
import {
  SidebarInset,
  SidebarProvider,
} from '@sunstead/ui/components/resizable-sidebar';
import { AppSidebar } from '@/components/app-sidebar';
import { TitleBarShell } from '@/components/title-bar';
import { QuickOpenDialog } from '@/components/quick-open-dialog';
import { useWorkspaceUIStore } from '@/lib/stores/workspace-ui-store';
import { useWorkspace } from '@/hooks/use-workspace';
import { registerCommand, runCommand } from '@/lib/commands';
import { useKeymapStore } from '@/lib/stores/keymap';
import { useGlobalKeybinds } from '@/hooks/use-global-keybinds';
import { useNativeMenuCommands } from '@/hooks/use-native-menu-commands';
import { useDevicePixelRatio } from '@/hooks/use-device-pixel-ratio';
import { DndProvider } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';
import { useLayout } from '@/hooks/use-layout';
import { getFileNameFromPath } from '@/lib/path-utils';
import { SettingsDialog } from '@/components/settings-dialog';
import { useSettingsDialog } from '@/lib/stores/settings-dialog';
import { loadGlobalSettings, useSettingsStore } from '@/lib/settings/store';
import { startFsWatch } from '@/lib/stores/fs-watch';
import { useSettingsDomBindings } from '@/lib/settings/apply';
import { useThemeEffect } from '@/hooks/use-theme';
import { useFileCommands } from '@/hooks/use-file-commands';
import { useDeepLinks } from '@/hooks/use-deep-links';
import { useSyncStatus } from '@/lib/stores/sync';
import { NewWorkspaceDialog } from '@/components/new-workspace-dialog';
import { useNewWorkspaceDialog } from '@/lib/stores/new-workspace-dialog';

export const Route = createRootRoute({
  // Named, so the hooks linter knows it's a component.
  component: function RootLayout() {
    const sidebarCollapsed = useWorkspaceUIStore((s) => s.sidebarCollapsed);
    const setSidebarCollapsed = useWorkspaceUIStore(
      (s) => s.setSidebarCollapsed,
    );
    const sidebarWidth = useWorkspaceUIStore((s) => s.sidebarWidth);
    const setSidebarWidth = useWorkspaceUIStore((s) => s.setSidebarWidth);

    // Global settings join the same gate: without it, theme and editor
    // typography would paint at their defaults for a frame before the stored
    // values land.
    const settingsLoaded = useSettingsStore((s) => s.globalLoaded);
    const [uiHydrated, setUiHydrated] = useState(
      useWorkspaceUIStore.persist.hasHydrated(),
    );
    const hydrated = uiHydrated && settingsLoaded;

    const [quickOpenOpen, setQuickOpenOpen] = useState(false);
    const openFile = useLayout((s) => s.openFile);

    const openFolder = useWorkspace((s) => s.openFolder);

    useDevicePixelRatio();
    useFileCommands();
    useThemeEffect();
    useSettingsDomBindings();
    useDeepLinks();
    useSyncStatus();

    useEffect(() => {
      // Global settings first: the workspace layer that `init` goes on to load
      // only ever overrides it, never replaces it.
      void loadGlobalSettings().then(() => useWorkspace.getState().init());
      return useWorkspaceUIStore.persist.onFinishHydration(() =>
        setUiHydrated(true),
      );
    }, []);

    useEffect(() => {
      // Register what each command id actually does, once.
      registerCommand('edit.bold', () => console.log('edit.bold'));
      registerCommand('view.toggle_sidebar', () =>
        console.log('view.toggle_sidebar'),
      );
      registerCommand('file.open_folder', () => openFolder());
      registerCommand('file.new_workspace', () => useNewWorkspaceDialog.getState().setOpen(true));
      registerCommand('file.open_file', () => setQuickOpenOpen(true));
      registerCommand('app.settings', () =>
        useSettingsDialog.getState().openSettings(),
      );

      // Fetch the resolved registry + subscribe to keymap-changed.
      void useKeymapStore.getState().init();

      // Subscribe to filesystem changes + window focus. Safe to call before a
      // workspace exists: the listener ignores batches for any other root.
      void startFsWatch();

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
    useNativeMenuCommands();

    // Holding the first paint until the stored settings land is what actually
    // prevents a flash of the defaults -- the `key` below only forces a
    // remount, it does not delay rendering. This is a single store read, so
    // the blank frame is a few milliseconds; the theme class is already on
    // <html> by then, so the window paints in the right colour.
    if (!settingsLoaded) return null;

    return (
      <DndProvider backend={HTML5Backend}>
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

        <QuickOpenDialog
          open={quickOpenOpen}
          onOpenChange={setQuickOpenOpen}
          onOpenFile={(path) => {
            openFile(path, getFileNameFromPath(path));
          }}
        />

        <NewWorkspaceDialog />

        {/* One app-wide instance; opened through useSettingsDialog. */}
        <SettingsDialog />
      </DndProvider>
    );
  },
});