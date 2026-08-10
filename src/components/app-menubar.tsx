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
} from '@/components/ui/menubar';
import { commands, events, type ResolvedMenu, type ResolvedMenuEntry, type NativeItem } from '@/bindings';
import { runCommand } from '@/lib/commands';
import { toDisplayFormat } from '@/lib/accelerator';

const NATIVE_SCOPED_COMMAND_IDS: Partial<Record<NativeItem, string>> = {
  Undo: 'native.undo',
  Redo: 'native.redo',
};

function runNativeItem(item: NativeItem) {
  switch (item) {
    case 'Cut':
      document.execCommand('cut');
      return;
    case 'Copy':
      document.execCommand('copy');
      return;
    case 'Paste':
      // execCommand('paste') is blocked in most Chromium builds
      // regardless of context -- Clipboard API instead. May prompt for
      // permission the first time on some platforms; worth testing
      // rather than assuming it's silent.
      navigator.clipboard.readText().then((text) => {
        document.execCommand('insertText', false, text);
      });
      return;
    case 'SelectAll':
      document.execCommand('selectAll');
      return;
    case 'Undo':
    case 'Redo': {
      const id = NATIVE_SCOPED_COMMAND_IDS[item];
      if (id) void runCommand(id);
      return;
    }
  }
}

function useMenuLayout() {
  const [layout, setLayout] = useState<ResolvedMenu[]>([]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;

    const refresh = () => {
      commands.getMenuLayout().then(setLayout).catch((err) => {
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

function MenuEntryView({ entry, keyPrefix }: { entry: ResolvedMenuEntry; keyPrefix: string }) {
  if (entry === 'Separator') {
    return <MenubarSeparator />;
  }

  if ('Command' in entry) {
    const c = entry.Command!;
    return (
      <MenubarItem onClick={() => void runCommand(c.id)}>
        {c.label}
        {c.default_accelerator && (
          <MenubarShortcut className='tracking-wide'>{toDisplayFormat(c.default_accelerator)}</MenubarShortcut>
        )}
      </MenubarItem>
    );
  }

  if ('Native' in entry) {
    const n = entry.Native!;
    return (
      <MenubarItem onClick={() => runNativeItem(n.item)}>
        {n.label}
        <MenubarShortcut className='tracking-wide'>{toDisplayFormat(n.accelerator)}</MenubarShortcut>
      </MenubarItem>
    );
  }

  const { title, entries } = entry.Submenu;
  return (
    <MenubarSub>
      <MenubarSubTrigger>{title}</MenubarSubTrigger>
      <MenubarSubContent>
        {entries.map((child, i) => (
          <MenuEntryView key={`${keyPrefix}-${i}`} entry={child} keyPrefix={`${keyPrefix}-${i}`} />
        ))}
      </MenubarSubContent>
    </MenubarSub>
  );
}

export function AppMenubar() {
  const layout = useMenuLayout();

  return (
    <Menubar className="border-none">
      {layout.map((menu) => (
        <MenubarMenu key={menu.title}>
          <MenubarTrigger>{menu.title}</MenubarTrigger>
          <MenubarContent className='w-max min-w-64'>
            {menu.entries.map((entry, i) => (
              <MenuEntryView key={`${menu.title}-${i}`} entry={entry} keyPrefix={`${menu.title}-${i}`} />
            ))}
          </MenubarContent>
        </MenubarMenu>
      ))}
    </Menubar>
  );
}