import { create } from "zustand";
import { CommandId, commands, events, type CommandMeta } from "@/bindings";

interface KeymapState {
  commands: CommandMeta[];
  loaded: boolean;
  init: () => Promise<void>;
  rebind: (commandId: CommandId, accelerator: string) => Promise<string | null>;
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

  init: async () => {
    await refresh(set);
    if (!unlisten) {
      unlisten = await events.keymapChanged.listen(() => refresh(set));
    }
  },

  rebind: async (commandId, accelerator) => {
    const result = await commands.setKeybind(commandId, accelerator);
    if (result.status === "error") return result.error;
    return null;
  },
}));