import { useActiveEditorStore } from "@/lib/stores/active-editor";

type Handler = () => void | Promise<void>;

const globalHandlers = new Map<string, Handler>();
const scopedHandlers = new Map<string, Map<string, Handler>>();

export function registerCommand(id: string, handler: Handler) {
  globalHandlers.set(id, handler);
}

export function unregisterCommand(id: string) {
  globalHandlers.delete(id);
}

export function registerScopedCommand(scopeId: string, id: string, handler: Handler) {
  let byScope = scopedHandlers.get(id);
  if (!byScope) {
    byScope = new Map();
    scopedHandlers.set(id, byScope);
  }
  byScope.set(scopeId, handler);
}

export function unregisterScopedCommand(scopeId: string, id: string) {
  const byScope = scopedHandlers.get(id);
  if (!byScope) return;
  byScope.delete(scopeId);
  if (byScope.size === 0) scopedHandlers.delete(id);
}

export async function runCommand(id: string) {
  console.log("running command:", id);
  const byScope = scopedHandlers.get(id);
  if (byScope && byScope.size > 0) {
    const activeEditorId = useActiveEditorStore.getState().activeEditorId;
    const handler = activeEditorId ? byScope.get(activeEditorId) : undefined;
    if (handler) {
      await handler();
      return;
    }
    
    console.warn(`Command "${id}" is editor-scoped but no focused editor handles it`);
    return;
  }

  const handler = globalHandlers.get(id);
  if (!handler) {
    console.warn(`No handler registered for command "${id}"`);
    return;
  }
  await handler();
}