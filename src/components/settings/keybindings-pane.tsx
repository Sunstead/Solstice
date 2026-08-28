import { useEffect } from 'react';

import { Keybind } from '@/components/keybind';
import { useKeymapStore } from '@/lib/stores/keymap';

/**
 * A custom (non-generated) pane, wired in through `customPanes`. Read-only:
 * rebinding additionally needs a `clear_override` command on the Rust side for
 * "reset to default", plus conflict detection.
 */
export function KeybindingsPane() {
  const commands = useKeymapStore((s) => s.commands);
  const loaded = useKeymapStore((s) => s.loaded);

  useEffect(() => {
    void useKeymapStore.getState().init();
  }, []);

  if (!loaded) {
    return (
      <p className='py-8 text-sm text-muted-foreground'>Loading commands…</p>
    );
  }

  return (
    <div className='divide-y divide-border/60'>
      {commands.map((command) => (
        <div
          key={command.id}
          className='flex items-center justify-between gap-8 py-2.5'
        >
          <div className='min-w-0'>
            <p className='truncate text-sm'>{command.label}</p>
            <p className='truncate font-mono text-[11px] text-muted-foreground'>
              {command.id}
            </p>
          </div>
          {command.default_accelerator ? (
            <Keybind accelerator={command.default_accelerator} />
          ) : (
            <span className='text-xs text-muted-foreground'>Unassigned</span>
          )}
        </div>
      ))}
    </div>
  );
}
