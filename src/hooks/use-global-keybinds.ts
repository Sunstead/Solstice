import { useEffect } from 'react';
import { tinykeys, defaultKeybindingsHandlerIgnore } from 'tinykeys';
import { commands } from '@/bindings';
import { useKeymapStore } from '@/lib/stores/keymap';
import { runCommand } from '../lib/commands';
import { toTinykeysFormat } from '../lib/accelerator';

/**
 * Binds every registry accelerator the OS is not already dispatching for
 * us. On macOS the native menu bar claims the accelerators of the commands
 * it contains before the keystroke ever reaches the webview, so those are
 * excluded here and arrive through the menu-command event instead. Every
 * other platform reports an empty claimed set and keeps the full bindings.
 */
export function useGlobalKeybinds() {
  const cmds = useKeymapStore((s) => s.commands);

  useEffect(() => {
    let unbind: (() => void) | undefined;
    let cancelled = false;

    void commands.getNativeMenuCommandIds().then((nativeIds) => {
      if (cancelled) return;

      const claimedByOs = new Set<string>(nativeIds);
      const bindings: Record<string, (e: KeyboardEvent) => void> = {};

      for (const c of cmds) {
        if (!c.default_accelerator || claimedByOs.has(c.id)) continue;
        bindings[toTinykeysFormat(c.default_accelerator)] = (e) => {
          if (e.defaultPrevented) return;
          e.preventDefault();

          e.stopPropagation();
          void runCommand(c.id);
        };
      }

      unbind = tinykeys(window, bindings, {
        capture: true,
        ignore: (event) => {
          const target = event.target as HTMLElement | null;
          if (target?.closest('[data-command-surface]')) return false;
          return defaultKeybindingsHandlerIgnore(event);
        },
      });
    });

    return () => {
      cancelled = true;
      unbind?.();
    };
  }, [cmds]);
}