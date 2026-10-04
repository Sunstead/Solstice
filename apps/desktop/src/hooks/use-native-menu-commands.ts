import { useEffect } from 'react';
import { events } from '@/lib/backend';
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
}