import { useEffect, useRef, useState } from 'react';

import { Keybind } from '@/components/keybind';
import { cn } from '@/lib/utils';
import { eventToAccelerator, modifiersOf } from '@/lib/accelerator';
import { useKeymapStore } from '@/lib/stores/keymap';
import type { CommandId } from '@/bindings';

interface KeybindRecorderProps {
  commandId: CommandId;
  accelerator: string | null;
  /** Marks the resting binding as shared with another command. */
  conflicting?: boolean;
}

/**
 * Click to record a keybind: held keys appear as they are pressed and the
 * binding saves when they are released. Escape cancels.
 *
 * While recording, `useKeymapStore.capturing` stands the global keybinds down
 * and the pane releases the native menu's key equivalents, so the combo being
 * recorded cannot also run a command.
 */
export function KeybindRecorder({
  commandId,
  accelerator,
  conflicting,
}: KeybindRecorderProps) {
  const setCapturing = useKeymapStore((s) => s.setCapturing);
  const rebind = useKeymapStore((s) => s.rebind);
  const ref = useRef<HTMLButtonElement>(null);

  // `null` when idle; otherwise the accelerator recorded so far, which is the
  // empty string while only modifiers are held.
  const [pending, setPending] = useState<string | null>(null);
  const recording = pending !== null;

  // A recorder that unmounts mid-capture must not leave the app suppressed.
  useEffect(() => () => setCapturing(false), [setCapturing]);

  const stop = () => {
    setPending(null);
    setCapturing(false);
  };

  const start = () => {
    setPending('');
    setCapturing(true);
    ref.current?.focus();
  };

  return (
    <button
      ref={ref}
      type='button'
      aria-label={recording ? 'Recording keybind' : 'Change keybind'}
      onClick={() => !recording && start()}
      onBlur={() => recording && stop()}
      onKeyDown={(event) => {
        if (!recording) return;
        // Nothing here should reach the dialog, the editor, or the browser.
        event.preventDefault();
        event.stopPropagation();

        if (event.key === 'Escape') {
          stop();
          return;
        }
        setPending(eventToAccelerator(event) ?? modifiersOf(event).join('+'));
      }}
      onKeyUp={(event) => {
        if (!recording) return;
        event.preventDefault();
        event.stopPropagation();

        // Releasing a modifier just narrows the display; only a complete
        // combination commits.
        if (!pending || !eventToAccelerator(event)) {
          setPending(modifiersOf(event).join('+'));
          return;
        }
        const next = pending;
        stop();
        void rebind(commandId, next);
      }}
      // Styled as a field rather than bare text: the binding is editable, and
      // nothing else in the row says so.
      // No resting border: 26 stacked boxes read as a form rather than a list
      // of shortcuts, so the row's hover state carries the affordance instead.
      className={cn(
        'flex h-7 w-full items-center justify-end rounded-md border border-transparent px-1.5 text-sm transition-[color,box-shadow] outline-none',
        recording
          ? 'border-ring bg-background ring-3 ring-ring/50'
          : 'group-hover/row:border-input group-hover/row:bg-background/60 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50',
      )}
    >
      {recording ? (
        pending ? (
          <Keybind accelerator={pending} />
        ) : (
          <span className='text-xs text-muted-foreground'>Press keys…</span>
        )
      ) : accelerator ? (
        <Keybind
          accelerator={accelerator}
          tone={conflicting ? 'warning' : 'default'}
        />
      ) : (
        <span className='text-xs text-muted-foreground'>Unassigned</span>
      )}
    </button>
  );
}
