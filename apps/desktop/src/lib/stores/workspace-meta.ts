import { create } from 'zustand';
import { commands } from '@/lib/backend';
import { defaultWorkspaceColor } from '@/lib/workspace/color';

/**
 * Each workspace's picked color (`.solstice/workspace.json` on a device, the
 * vault's on the web), by path; `null` when none was picked. Read from disk
 * first, then brought in step with the sync server, which may have one picked
 * on another device.
 */
interface WorkspaceMetaState {
  colors: Record<string, string | null>;
  load: (paths: string[]) => Promise<void>;
  /** Saves a color (`null`: back to the one from the name); the error, if it failed. */
  setColor: (path: string, color: string | null) => Promise<string | null>;
}

/** The color a workspace shows: the picked one, else the one from its name. */
export function workspaceColor(name: string, stored: string | null | undefined): string {
  return stored ?? defaultWorkspaceColor(name);
}

export const useWorkspaceMeta = create<WorkspaceMetaState>((set, get) => {
  const merge = (paths: string[], metas: { color: string | null }[]) =>
    set({ colors: { ...get().colors, ...Object.fromEntries(paths.map((p, i) => [p, metas[i]?.color ?? null])) } });

  return {
    colors: {},

    load: async (paths) => {
      if (paths.length === 0) return;
      merge(paths, await commands.workspaceMeta(paths));
      try {
        merge(paths, await commands.syncPullColors(paths));
      } catch (error) {
        console.warn('[workspace-meta] colors not pulled from sync:', error);
      }
    },

    setColor: async (path, color) => {
      const before = get().colors[path] ?? null;
      set({ colors: { ...get().colors, [path]: color } });
      const result = await commands.setWorkspaceColor(path, color);
      if (result.status === 'error') {
        set({ colors: { ...get().colors, [path]: before } });
        return result.error;
      }
      set({ colors: { ...get().colors, [path]: result.data.color } });
      return null;
    },
  };
});
