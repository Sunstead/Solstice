import { useEffect } from 'react';
import { tinykeys, defaultKeybindingsHandlerIgnore } from 'tinykeys';
import type { CommandId } from '@/bindings';
import { commands } from '@/lib/backend';
import { useKeymapStore } from '@/lib/stores/keymap';
import { runCommand } from '../lib/commands';
import { toTinykeysFormat } from '../lib/accelerator';
import { commandScope, pickCommand } from '../lib/command-scope';

/**
 * Binds every registry accelerator the OS is not already dispatching for
 * us. On macOS the native menu bar claims the accelerators of the commands
 * it contains before the keystroke ever reaches the webview, so those are
 * excluded here and arrive through the menu-command event instead. Every
 * other platform reports an empty claimed set and keeps the full bindings.
 *
 * A key can belong to one global command and one canvas command. On a focused
 * board the canvas one runs; anywhere else the global one does, and a canvas
 * key with no global partner is left alone so it types normally.
 */
export function useGlobalKeybinds() {
  const cmds = useKeymapStore((s) => s.commands);

  useEffect(() => {
    let unbind: (() => void) | undefined;
    let cancelled = false;

    void commands.getNativeMenuCommandIds().then((nativeIds) => {
      if (cancelled) return;

      const claimedByOs = new Set<string>(nativeIds);
      const byKey = new Map<string, { global?: CommandId; canvas?: CommandId }>();
      for (const c of cmds) {
        if (!c.accelerator || claimedByOs.has(c.id)) continue;
        const key = toTinykeysFormat(c.accelerator);
        const slot = byKey.get(key) ?? {};
        slot[commandScope(c.id)] ??= c.id;
        byKey.set(key, slot);
      }

      const bindings: Record<string, (e: KeyboardEvent) => void> = {};
      for (const [key, slot] of byKey) {
        bindings[key] = (e) => {
          if (e.defaultPrevented) return;
          // Read at dispatch rather than as a dependency, so entering capture
          // does not rebuild every binding.
          if (useKeymapStore.getState().capturing) return;
          const id = pickCommand(slot, e.target);
          if (!id) return;
          e.preventDefault();

          e.stopPropagation();
          void runCommand(id);
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