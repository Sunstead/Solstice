import type { CommandMeta } from '@/bindings';

/**
 * Where a command's shortcut works. Canvas commands act on the focused board
 * and their keys only mean something there, so they can be plain letters
 * (`N` for a new card) without stealing typing anywhere else. Everything else
 * is global. Mirrors `CommandId::is_canvas` in the registry.
 */
export type CommandScope = 'global' | 'canvas';

export function commandScope(id: string): CommandScope {
  return id.startsWith('canvas.') ? 'canvas' : 'global';
}

/**
 * Whether a keystroke landed on a canvas board itself: inside one, and not in
 * a card being edited or any other text field.
 */
export function isOnBoard(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  if (!target.closest('[data-canvas-board]')) return false;
  if (target.closest('[data-canvas-editing]')) return false;
  if (target instanceof HTMLElement && target.isContentEditable) return false;
  return !target.matches('input, textarea, select');
}

/** Which of a key's commands a keystroke on `target` runs, if any. */
export function pickCommand<T>(
  slot: { global?: T; canvas?: T },
  target: EventTarget | null,
): T | undefined {
  return slot.canvas !== undefined && isOnBoard(target) ? slot.canvas : slot.global;
}

/**
 * For each command, what else answers to its accelerator. A canvas command
 * only competes with other canvas commands: on a board it wins, and anywhere
 * else the global one does.
 */
export function findConflicts(
  registry: Pick<CommandMeta, 'id' | 'label' | 'accelerator'>[],
  reserved: Map<string, string>,
): Map<string, string> {
  const owners = new Map<string, string[]>();
  const keyOf = (id: string, accelerator: string) =>
    `${commandScope(id)}:${accelerator}`;
  for (const command of registry) {
    if (!command.accelerator) continue;
    const key = keyOf(command.id, command.accelerator);
    owners.set(key, [...(owners.get(key) ?? []), command.label]);
  }

  const conflicts = new Map<string, string>();
  for (const command of registry) {
    const accelerator = command.accelerator;
    if (!accelerator) continue;
    const others = (owners.get(keyOf(command.id, accelerator)) ?? []).filter(
      (label) => label !== command.label,
    );
    const reservedBy = reserved.get(accelerator);
    if (reservedBy) others.push(`${reservedBy} (system)`);
    if (others.length > 0) conflicts.set(command.id, others.join(', '));
  }
  return conflicts;
}
