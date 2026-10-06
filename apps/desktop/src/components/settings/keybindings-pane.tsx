import { useEffect, useMemo, useState } from 'react';
import { RotateCcw } from 'lucide-react';

import { Button } from '@sunstead/ui/components/button';
import { cn } from '@/lib/utils';
import { commands } from '@/lib/backend';
import { type CommandMeta } from '@/bindings';
import { findConflicts } from '@/lib/command-scope';
import { useKeymapStore } from '@/lib/stores/keymap';
import { KeybindRecorder } from './keybind-recorder';

/**
 * Accelerators the OS answers to itself (Undo, Copy, Paste and friends). They
 * live outside the command registry but still win over anything bound to them,
 * so they count as conflicts. Read from the resolved menu rather than
 * duplicated here, since `menu_layout.rs` owns the list.
 */
function useReservedAccelerators() {
  const [reserved, setReserved] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    let cancelled = false;
    void commands.getMenuLayout().then((menus) => {
      if (cancelled) return;
      const found = new Map<string, string>();
      const walk = (entries: (typeof menus)[number]['entries']) => {
        for (const entry of entries) {
          if (entry === 'Separator') continue;
          if ('Native' in entry) {
            found.set(entry.Native!.accelerator, entry.Native!.label);
          } else if ('Submenu' in entry) {
            walk(entry.Submenu!.entries);
          }
        }
      };
      for (const menu of menus) walk(menu.entries);
      setReserved(found);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return reserved;
}

/**
 * Section headings, keyed by the command id prefix. An unlisted prefix falls
 * back to itself, capitalised, so a new command family shows up under a
 * heading without needing an entry here.
 */
const GROUP_LABELS: Record<string, string> = {
  app: 'Application',
  file: 'File',
  edit: 'Editing',
  view: 'View',
  navigation: 'Navigation',
  canvas: 'Canvas',
};

/** A line under a heading, for families whose keys only work somewhere. */
const GROUP_NOTES: Record<string, string> = {
  canvas: 'These work while a canvas is focused.',
};

function groupByFamily(registry: CommandMeta[]) {
  const groups = new Map<string, CommandMeta[]>();
  for (const command of registry) {
    const family = command.id.split('.')[0];
    groups.set(family, [...(groups.get(family) ?? []), command]);
  }
  return [...groups].map(([family, commands]) => ({
    family,
    label: GROUP_LABELS[family] ?? family.charAt(0).toUpperCase() + family.slice(1),
    note: GROUP_NOTES[family],
    commands,
  }));
}

/**
 * A custom (non-generated) pane, wired in through `customPanes`. Click a
 * binding to record a new one.
 *
 * Conflicts are surfaced rather than prevented: a duplicate accelerator saves
 * like any other and both rows are marked, since which one wins is a property
 * of the platform rather than something this list decides.
 */
export function KeybindingsPane() {
  const registry = useKeymapStore((s) => s.commands);
  const loaded = useKeymapStore((s) => s.loaded);
  const capturing = useKeymapStore((s) => s.capturing);
  const clearBinding = useKeymapStore((s) => s.clearBinding);
  const reserved = useReservedAccelerators();

  useEffect(() => {
    void useKeymapStore.getState().init();
  }, []);

  // The native menu resolves its key equivalents before the webview sees a
  // keydown, so they are released for the duration of a recording. The cleanup
  // restores them however the recording ends, including the dialog closing.
  useEffect(() => {
    if (!capturing) return;
    void commands.setMenuAcceleratorsEnabled(false);
    return () => {
      void commands.setMenuAcceleratorsEnabled(true);
    };
  }, [capturing]);

  const conflicts = useMemo(
    () => findConflicts(registry, reserved),
    [registry, reserved],
  );

  if (!loaded) {
    return (
      <p className='py-8 text-sm text-muted-foreground'>Loading commands…</p>
    );
  }

  return (
    <div className='flex flex-col gap-6'>
      {groupByFamily(registry).map((group) => (
        <section key={group.family}>
          <h3 className='pb-1 text-xs font-medium text-muted-foreground'>
            {group.label}
          </h3>
          {group.note && (
            <p className='pb-1 text-xs text-muted-foreground'>{group.note}</p>
          )}
          {group.commands.map((command) => {
            const conflict = conflicts.get(command.id);
            return (
              <div
                key={command.id}
                title={command.id}
                className='group/row flex items-center gap-4 rounded-md py-0.5 pr-1 pl-2 hover:bg-foreground/4'
              >
                <span className='min-w-0 flex-1 truncate text-sm'>
                  {command.label}
                </span>
                {conflict && (
                  <span className='shrink-0 text-[11px] text-warning'>
                    Also bound to {conflict}
                  </span>
                )}

                <div className='w-28 shrink-0 sm:w-36'>
                  <KeybindRecorder
                    commandId={command.id}
                    accelerator={command.accelerator}
                    conflicting={conflict !== undefined}
                  />
                </div>
                <Button
                  variant='ghost'
                  size='icon-sm'
                  aria-hidden={!command.is_overridden}
                  tabIndex={command.is_overridden ? undefined : -1}
                  title='Reset to default'
                  onClick={() => void clearBinding(command.id)}
                  className={cn(
                    'size-7 shrink-0 text-muted-foreground transition-none',
                    !command.is_overridden && 'pointer-events-none opacity-0',
                  )}
                >
                  <RotateCcw className='size-3.5' />
                  <span className='sr-only'>Reset {command.label}</span>
                </Button>
              </div>
            );
          })}
        </section>
      ))}
    </div>
  );
}
