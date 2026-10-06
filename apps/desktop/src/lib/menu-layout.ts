import { useEffect, useState } from 'react';
import { commands, events } from '@/lib/backend';
import { type ResolvedMenu, type ResolvedMenuEntry, type NativeItem } from '@/bindings';
import { runCommand, type NativeCommandId } from '@/lib/commands';

/*
 * The app menu's data, shared by the dropdown in the title bar and the phone
 * layout's menu sheet.
 */

// Every native item is now backed by a scoped command registered per
// editor instance (milkdown-editor.tsx) -- Undo/Redo always were, and
// Cut/Copy/Paste/SelectAll now are too, so they get a real
// enabled/disabled reading and operate on the sticky active editor
// instead of document.execCommand against whatever currently has DOM
// focus (which, by the time a menu click fires, is no longer the
// editor -- see milkdown-editor.tsx for why).
export const NATIVE_SCOPED_COMMAND_IDS: Record<NativeItem, NativeCommandId> = {
  Undo: 'native.undo',
  Redo: 'native.redo',
  Cut: 'native.cut',
  Copy: 'native.copy',
  Paste: 'native.paste',
  SelectAll: 'native.select_all',
};

export function collectCommandIds(
  entries: ResolvedMenuEntry[],
  out: string[] = [],
): string[] {
  for (const entry of entries) {
    if (entry === 'Separator') continue;
    if ('Command' in entry) out.push(entry.Command!.id);
    else if ('Native' in entry)
      out.push(NATIVE_SCOPED_COMMAND_IDS[entry.Native!.item]);
    else if ('Submenu' in entry) collectCommandIds(entry.Submenu.entries, out);
  }
  return out;
}

/** Runs an Undo/Copy/... item through the focused editor's command. */
export function runNativeItem(item: NativeItem) {
  void runCommand(NATIVE_SCOPED_COMMAND_IDS[item]);
}

/** The menus, refreshed when the keymap changes. */
export function useMenuLayout() {
  const [layout, setLayout] = useState<ResolvedMenu[]>([]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;

    const refresh = () => {
      commands
        .getMenuLayout()
        .then(setLayout)
        .catch((err) => {
          console.error('Failed to load menu layout:', err);
        });
    };

    refresh();
    events.keymapChanged.listen(refresh).then((fn) => {
      unlisten = fn;
    });

    return () => unlisten?.();
  }, []);

  return layout;
}
