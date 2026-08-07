import { useEffect } from 'react';
import { tinykeys } from 'tinykeys';
import { useKeymapStore } from '@/lib/stores/keymap';
import { runCommand } from '../lib/commands';
import { toTinykeysFormat } from '../lib/accelerator';

export function useGlobalKeybinds() {
  const cmds = useKeymapStore((s) => s.commands);

  useEffect(() => {
    const bindings: Record<string, (e: KeyboardEvent) => void> = {};

    for (const c of cmds) {
      if (!c.default_accelerator) continue;
      bindings[toTinykeysFormat(c.default_accelerator)] = (e) => {
        
        if (e.defaultPrevented) return;
        e.preventDefault();
        void runCommand(c.id);
      };
    }

    const unbind = tinykeys(window, bindings);
    return unbind;
  }, [cmds]);
}
