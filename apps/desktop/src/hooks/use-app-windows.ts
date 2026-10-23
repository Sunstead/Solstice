import { useEffect } from 'react';

import { commands, events } from '@/lib/backend';
import { can } from '@/lib/backend/platform';
import { getCurrentWindow } from '@/lib/backend/window';
import { flushAllAutosavers } from '@/lib/autosave';
import { registerCommand, unregisterCommand } from '@/lib/commands';
import { getActiveTabId, useLayout } from '@/hooks/use-layout';
import { loadGlobalSettings, loadWorkspaceSettings } from '@/lib/settings/store';
import { moveTabToNewWindow } from '@/lib/tab-transfer';

/**
 * This window among the others: New Window and Move Tab to New Window, its
 * editors saved before it closes or another window asks (an update), and
 * settings another window changed read again.
 */
export function useAppWindows() {
  useEffect(() => {
    if (!can.multiWindow) return;

    registerCommand('window.new', () => {
      void commands.openWindow({ editor: false, workspace: null, tab: null, at: null });
    });
    registerCommand(
      'window.move_tab_to_new_window',
      () => {
        const { model } = useLayout.getState();
        const id = getActiveTabId(model);
        if (model && id) void moveTabToNewWindow(model, id);
      },
      () => getActiveTabId(useLayout.getState().model) !== null,
    );

    const unlisten = [
      // Closing waits for the handler: nothing typed is lost with the window.
      getCurrentWindow().onCloseRequested(async () => {
        await flushAllAutosavers();
      }),
      events.flushRequested.listen(async (e) => {
        await flushAllAutosavers();
        await commands.windowsFlushed(e.payload.id);
      }),
      events.storeChanged.listen((e) => {
        void (e.payload.file === 'global' ? loadGlobalSettings() : loadWorkspaceSettings());
      }),
    ];

    return () => {
      unregisterCommand('window.new');
      unregisterCommand('window.move_tab_to_new_window');
      for (const u of unlisten) void u.then((f) => f());
    };
  }, []);
}
