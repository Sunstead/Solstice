import { useEffect, useState } from 'react';
import {
  Menubar,
  MenubarContent,
  MenubarItem,
  MenubarMenu,
  MenubarSeparator,
  MenubarSub,
  MenubarSubContent,
  MenubarSubTrigger,
  MenubarShortcut,
  MenubarTrigger,
} from '@sunstead/ui/components/menubar';
import { commands, events } from '@/lib/backend';
import { type ResolvedMenu, type ResolvedMenuEntry, type NativeItem } from '@/bindings';
import { isCommandEnabled, NativeCommandId, runCommand } from '@/lib/commands';
import { toDisplayFormat } from '@/lib/accelerator';
import { useActiveEditorStore } from '@/lib/stores/active-editor';

// Every native item is now backed by a scoped command registered per
// editor instance (milkdown-editor.tsx) -- Undo/Redo always were, and
// Cut/Copy/Paste/SelectAll now are too, so they get a real
// enabled/disabled reading and operate on the sticky active editor
// instead of document.execCommand against whatever currently has DOM
// focus (which, by the time a menu click fires, is no longer the
// editor -- see milkdown-editor.tsx for why).
const NATIVE_SCOPED_COMMAND_IDS: Record<NativeItem, NativeCommandId> = {
  Undo: 'native.undo',
  Redo: 'native.redo',
  Cut: 'native.cut',
  Copy: 'native.copy',
  Paste: 'native.paste',
  SelectAll: 'native.select_all',
};

function collectCommandIds(
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

function runNativeItem(item: NativeItem) {
  void runCommand(NATIVE_SCOPED_COMMAND_IDS[item]);
}

function useMenuLayout() {
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

function MenuEntryView({
  entry,
  keyPrefix,
  enabled,
}: {
  entry: ResolvedMenuEntry;
  keyPrefix: string;
  enabled: Record<string, boolean>;
}) {
  if (entry === 'Separator') return <MenubarSeparator />;

  if ('Command' in entry) {
    const c = entry.Command!;
    const isEnabled = enabled[c.id] ?? true;
    return (
      <MenubarItem disabled={!isEnabled} onClick={() => void runCommand(c.id)}>
        {c.label}
        {c.accelerator && (
          <MenubarShortcut className='tracking-wide'>
            {toDisplayFormat(c.accelerator)}
          </MenubarShortcut>
        )}
      </MenubarItem>
    );
  }

  if ('Native' in entry) {
    const n = entry.Native!;
    const isEnabled = enabled[NATIVE_SCOPED_COMMAND_IDS[n.item]] ?? true;
    return (
      <MenubarItem disabled={!isEnabled} onClick={() => runNativeItem(n.item)}>
        {n.label}
        <MenubarShortcut className='tracking-wide'>
          {toDisplayFormat(n.accelerator)}
        </MenubarShortcut>
      </MenubarItem>
    );
  }

  const { title, entries } = entry.Submenu;
  return (
    <MenubarSub>
      <MenubarSubTrigger>{title}</MenubarSubTrigger>
      <MenubarSubContent>
        {entries.map((child, i) => (
          <MenuEntryView
            key={`${keyPrefix}-${i}`}
            entry={child}
            keyPrefix={`${keyPrefix}-${i}`}
            enabled={enabled}
          />
        ))}
      </MenubarSubContent>
    </MenubarSub>
  );
}

export function AppMenubar() {
  const layout = useMenuLayout();

  useActiveEditorStore((s) => s.activeEditorId);
  useActiveEditorStore((s) => s.commandStateVersion);

  return (
    <Menubar className='border-none'>
      {layout.map((menu) => {
        const ids = collectCommandIds(menu.entries);
        const enabled: Record<string, boolean> = {};
        for (const id of ids) enabled[id] = isCommandEnabled(id);

        return (
          <MenubarMenu key={menu.title}>
            <MenubarTrigger>{menu.title}</MenubarTrigger>
            <MenubarContent className='w-max min-w-64'>
              {menu.entries.map((entry, i) => (
                <MenuEntryView
                  key={`${menu.title}-${i}`}
                  entry={entry}
                  keyPrefix={`${menu.title}-${i}`}
                  enabled={enabled}
                />
              ))}
            </MenubarContent>
          </MenubarMenu>
        );
      })}
    </Menubar>
  );
}
