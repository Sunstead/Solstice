import { useActiveEditorStore } from '@/lib/stores/active-editor';

type Handler = () => void | Promise<void>;
type IsEnabled = () => boolean;
type Entry = { handler: Handler; isEnabled?: IsEnabled };

const globalHandlers = new Map<string, Entry>();
const scopedHandlers = new Map<string, Map<string, Entry>>();

export function registerCommand(
  id: string,
  handler: Handler,
  isEnabled?: IsEnabled,
) {
  globalHandlers.set(id, { handler, isEnabled });
}

export function unregisterCommand(id: string) {
  globalHandlers.delete(id);
}

export function registerScopedCommand(
  scopeId: string,
  id: string,
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

export function unregisterScopedCommand(scopeId: string, id: string) {
  const byScope = scopedHandlers.get(id);
  if (!byScope) return;
  byScope.delete(scopeId);
  if (byScope.size === 0) scopedHandlers.delete(id);
}

/**
 * Resolves a command id to the Entry that would actually run for it right
 * now: the focused editor's scoped handler if the id is editor-scoped,
 * otherwise the global handler. isCommandEnabled and runCommand both go
 * through this so they can never disagree on what a command id resolves
 * to -- previously each had its own copy of this lookup, and only one of
 * them checked `isEnabled`, which is how a menu item could show disabled
 * while its keyboard shortcut still fired.
 */
function resolveEntry(id: string): Entry | undefined {
  const byScope = scopedHandlers.get(id);
  if (byScope && byScope.size > 0) {
    const activeEditorId = useActiveEditorStore.getState().activeEditorId;
    return activeEditorId ? byScope.get(activeEditorId) : undefined;
  }
  return globalHandlers.get(id);
}

export async function runCommand(id: string) {
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
  console.log('running command:', id);
  await entry.handler();
}

export function isCommandEnabled(id: string): boolean {
  const entry = resolveEntry(id);
  if (!entry) return false;
  return entry.isEnabled ? entry.isEnabled() : true;
}
