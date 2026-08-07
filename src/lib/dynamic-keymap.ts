// The Milkdown-native way to register/override keyboard shortcuts:
// $useKeymap plugs into the same KeymapManager (keymapCtx) that
// preset-commonmark's own bold/italic/etc. shortcuts go through.
// KeymapManager groups everything by key and sorts by priority
// (default 50, higher runs first) into ONE combined ProseMirror keymap
// plugin -- so this is the only way to reliably win against a preset
// default, short of removing the preset's binding entirely.
//
// PRIORITY: 100 is comfortably above the documented default of 50. If a
// future preset-commonmark version pins its own shortcuts above 100,
// bump this to match (check that version's mark/strong.ts / emphasis.ts).
import { $useKeymap } from '@milkdown/kit/utils';
import type { CommandMeta } from '@/bindings';
import { runCommand } from './commands';
import { toProseMirrorFormat } from './accelerator';

const EDIT_KEYMAP_PRIORITY = 100;

export function buildDynamicEditKeymap(cmds: CommandMeta[]) {
  const editCmds = cmds.filter((c) => c.group === 'edit' && c.default_accelerator);

  const bindings = Object.fromEntries(
    editCmds.map((c) => [
      c.id,
      {
        shortcuts: toProseMirrorFormat(c.default_accelerator!),
        command: () => () => {
          void runCommand(c.id);
          return true;
        },
        priority: EDIT_KEYMAP_PRIORITY,
      },
    ]),
  );

  return $useKeymap('dynamicEditKeymap', bindings);
}