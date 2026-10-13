import { useEffect } from 'react';
import { commands, events } from '@/lib/backend';
import { can } from '@/lib/backend/platform';
import { runCommand } from '../lib/commands';

/**
 * Routes native menu activations into the same handler registry keybinds
 * use, so a menu click, a menu accelerator and a tinykeys binding all
 * resolve identically. Inert on platforms with no native menu.
 */
export function useNativeMenuCommands() {
  useEffect(() => {
    const unlisten = events.menuCommand.listen((e) => {
      void runCommand(e.payload);
    });

    return () => {
      void unlisten.then((stop) => stop());
    };
  }, []);

  // The iPad's menu bar is built by the plugin from the menus sent here, and
  // again when a shortcut changes.
  useEffect(() => {
    if (!can.nativeViews) return;
    let cancelled = false;
    const stops: Promise<() => void>[] = [];
    void import('@/lib/backend/native').then(({ nativeMenu }) => {
      if (cancelled) return;
      const send = () => void commands.getMenuLayout().then((menus) => nativeMenu.set(menus));
      send();
      stops.push(events.keymapChanged.listen(send));
      stops.push(
        nativeMenu.listen((id) => void runCommand(id)).then((listener) => () => void listener.unregister()),
      );
    });
    return () => {
      cancelled = true;
      for (const stop of stops) void stop.then((s) => s());
    };
  }, []);
}
