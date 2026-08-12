import { CommandId } from '@/bindings';
import { useActiveEditorStore } from '@/lib/stores/active-editor';

export type NativeCommandId =
  | 'native.undo'
  | 'native.redo'
  | 'native.cut'
  | 'native.copy'
  | 'native.paste'
  | 'native.select_all';

export type ScopedCommandId = CommandId | NativeCommandId;

type Handler = () => void | Promise<void>;
type IsEnabled = () => boolean;
type Entry = { handler: Handler; isEnabled?: IsEnabled };

const globalHandlers = new Map<string, Entry>();
const scopedHandlers = new Map<string, Map<string, Entry>>();

export function registerCommand(
  id: ScopedCommandId,
  handler: Handler,
  isEnabled?: IsEnabled,
) {
  globalHandlers.set(id, { handler, isEnabled });
}

export function unregisterCommand(id: ScopedCommandId) {
  globalHandlers.delete(id);
}

export function registerScopedCommand(
  scopeId: string,
  id: ScopedCommandId,
  handler: Handler,
  isEnabled?: IsEnabled,
) {
  let byScope = scopedHandlers.get(id);
  if (!byScope) {
    byScope = new Map();
    scopedHandlers.set(id, byScope);
  }
  byScope.set(scopeId, { handler, isEnabled });
}

export function unregisterScopedCommand(scopeId: string, id: ScopedCommandId) {
  const byScope = scopedHandlers.get(id);
  if (!byScope) return;
  byScope.delete(scopeId);
  if (byScope.size === 0) scopedHandlers.delete(id);
}

function resolveEntry(id: string): Entry | undefined {
  const byScope = scopedHandlers.get(id);
  if (byScope && byScope.size > 0) {
    const activeEditorId = useActiveEditorStore.getState().activeEditorId;
    return activeEditorId ? byScope.get(activeEditorId) : undefined;
  }
  return globalHandlers.get(id);
}

export async function runCommand(id: CommandId | NativeCommandId) {
  const entry = resolveEntry(id);
  if (!entry) {
    console.warn(
      scopedHandlers.has(id)
        ? `Command "${id}" is editor-scoped but no focused editor handles it`
        : `No handler registered for command "${id}"`,
    );
    return;
  }
  if (entry.isEnabled && !entry.isEnabled()) {
    console.warn(`Command "${id}" is disabled, ignoring run request`);
    return;
  }
  await entry.handler();
}

export function isCommandEnabled(id: string): boolean {
  const entry = resolveEntry(id);
  if (!entry) return false;
  return entry.isEnabled ? entry.isEnabled() : true;
}
