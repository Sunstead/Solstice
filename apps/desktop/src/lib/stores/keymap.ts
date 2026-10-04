import { create } from "zustand";
import { commands, events } from "@/lib/backend";
import { CommandId, type CommandMeta } from "@/bindings";

interface KeymapState {
  commands: CommandMeta[];
  loaded: boolean;
  /**
   * A row is recording a keystroke. Global keybinds stand down while this is
   * set, so the combo being recorded does not also run a command.
   */
  capturing: boolean;
  init: () => Promise<void>;
  setCapturing: (capturing: boolean) => void;
  rebind: (commandId: CommandId, accelerator: string) => Promise<string | null>;
  clearBinding: (commandId: CommandId) => Promise<string | null>;
}

let unlisten: (() => void) | null = null;

async function refresh(set: (partial: Partial<KeymapState>) => void) {
  try {
    const data = await commands.getCommandRegistry();
    set({ commands: data, loaded: true });
  } catch (err) {
    console.error("Failed to load command registry:", err);
  }
}

export const useKeymapStore = create<KeymapState>((set) => ({
  commands: [],
  loaded: false,
  capturing: false,

  init: async () => {
    await refresh(set);
    if (!unlisten) {
      unlisten = await events.keymapChanged.listen(() => refresh(set));
    }
  },

  setCapturing: (capturing) => set({ capturing }),

  rebind: async (commandId, accelerator) => {
    const result = await commands.setKeybind(commandId, accelerator);
    if (result.status === "error") return result.error;
    return null;
  },

  clearBinding: async (commandId) => {
    const result = await commands.clearKeybind(commandId);
    if (result.status === "error") return result.error;
    return null;
  },
}));