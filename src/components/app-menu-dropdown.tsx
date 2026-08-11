import { useEffect, useState } from 'react';
import { Menu } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  commands,
  events,
  type ResolvedMenu,
  type ResolvedMenuEntry,
  type NativeItem,
} from '@/bindings';
import { isCommandEnabled, runCommand } from '@/lib/commands';
import { toDisplayFormat } from '@/lib/accelerator';
import { useActiveEditorStore } from '@/lib/stores/active-editor';

// Every native item is now backed by a scoped command registered per
// editor instance (milkdown-editor.tsx) -- Undo/Redo always were, and
// Cut/Copy/Paste/SelectAll now are too, so they get a real
// enabled/disabled reading and operate on the sticky active editor
// instead of document.execCommand against whatever currently has DOM
// focus (which, by the time a menu click fires, is no longer the
// editor -- see milkdown-editor.tsx for why).
const NATIVE_SCOPED_COMMAND_IDS: Record<NativeItem, string> = {
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

// Blocks the browser's default "focus whatever you mousedown on" behavior.
// The click still fires (and still opens/selects), but the editor never
// loses focus to a native mousedown-focus grab.
function preventFocusSteal(e: React.MouseEvent) {
  e.preventDefault();
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

// Same recursive rendering as the Menubar version, just swapped onto the
// Dropdown primitives: MenubarItem -> DropdownMenuItem, MenubarSub ->
// DropdownMenuSub, etc. Nested "Submenu" entries (e.g. File > Export)
// keep nesting fine since DropdownMenuSub can be nested arbitrarily deep.
function MenuEntryView({
  entry,
  keyPrefix,
  enabled,
}: {
  entry: ResolvedMenuEntry;
  keyPrefix: string;
  enabled: Record<string, boolean>;
}) {
  if (entry === 'Separator') return <DropdownMenuSeparator />;

  if ('Command' in entry) {
    const c = entry.Command!;
    const isEnabled = enabled[c.id] ?? true;
    return (
      <DropdownMenuItem
        disabled={!isEnabled}
        onMouseDown={preventFocusSteal}
        onClick={() => void runCommand(c.id)}
      >
        {c.label}
        {c.default_accelerator && (
          <DropdownMenuShortcut className='tracking-wide'>
            {toDisplayFormat(c.default_accelerator)}
          </DropdownMenuShortcut>
        )}
      </DropdownMenuItem>
    );
  }

  if ('Native' in entry) {
    const n = entry.Native!;
    const isEnabled = enabled[NATIVE_SCOPED_COMMAND_IDS[n.item]] ?? true;
    return (
      <DropdownMenuItem
        disabled={!isEnabled}
        onMouseDown={preventFocusSteal}
        onClick={() => runNativeItem(n.item)}
      >
        {n.label}
        <DropdownMenuShortcut className='tracking-wide'>
          {toDisplayFormat(n.accelerator)}
        </DropdownMenuShortcut>
      </DropdownMenuItem>
    );
  }

  const { title, entries } = entry.Submenu;
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger onMouseDown={preventFocusSteal}>
        {title}
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent finalFocus={false}>
        {entries.map((child, i) => (
          <MenuEntryView
            key={`${keyPrefix}-${i}`}
            entry={child}
            keyPrefix={`${keyPrefix}-${i}`}
            enabled={enabled}
          />
        ))}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

export function AppMenubar() {
  const layout = useMenuLayout();

  useActiveEditorStore((s) => s.activeEditorId);
  useActiveEditorStore((s) => s.commandStateVersion);

  // Every top-level menu (File / Edit / View / ...) that used to be its
  // own MenubarMenu trigger is now a DropdownMenuSub nested one level
  // under a single trigger, so File/Edit/View all live inside one
  // dropdown instead of sitting side by side in a menu bar.
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant='ghost' size='icon' onMouseDown={preventFocusSteal}>
            <Menu className='h-4 w-4' />
          </Button>
        }
      />
      <DropdownMenuContent
        className='w-max min-w-64'
        align='start'
        finalFocus={false}
      >
        {layout.map((menu) => {
          const ids = collectCommandIds(menu.entries);
          const enabled: Record<string, boolean> = {};
          for (const id of ids) enabled[id] = isCommandEnabled(id);

          return (
            <DropdownMenuSub key={menu.title}>
              <DropdownMenuSubTrigger onMouseDown={preventFocusSteal}>
                {menu.title}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent
                className='w-max min-w-64'
                finalFocus={false}
              >
                {menu.entries.map((entry, i) => (
                  <MenuEntryView
                    key={`${menu.title}-${i}`}
                    entry={entry}
                    keyPrefix={`${menu.title}-${i}`}
                    enabled={enabled}
                  />
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
