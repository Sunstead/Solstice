import { useEffect, useId } from 'react';
import {
  Editor,
  rootCtx,
  defaultValueCtx,
  editorViewCtx,
} from '@milkdown/kit/core';
import {
  history,
  redoCommand,
  undoCommand,
} from '@milkdown/kit/plugin/history';
import {
  commonmark,
  toggleStrongCommand,
  toggleEmphasisCommand,
  toggleInlineCodeCommand,
  wrapInHeadingCommand,
  wrapInBlockquoteCommand,
  wrapInBulletListCommand,
  wrapInOrderedListCommand,
  createCodeBlockCommand,
  insertHardbreakCommand,
  turnIntoTextCommand,
  strongKeymap,
  emphasisKeymap,
  inlineCodeKeymap,
  headingKeymap,
  blockquoteKeymap,
  bulletListKeymap,
  orderedListKeymap,
  codeBlockKeymap,
  hardbreakKeymap,
  paragraphKeymap,
} from '@milkdown/kit/preset/commonmark';
import {
  gfm,
  toggleStrikethroughCommand,
  strikethroughKeymap,
} from '@milkdown/kit/preset/gfm';
import { listener, listenerCtx } from '@milkdown/kit/plugin/listener';
import { callCommand } from '@milkdown/kit/utils';
import { Milkdown, MilkdownProvider, useEditor } from '@milkdown/react';
import { commands } from '@/bindings';
import { registerScopedCommand, unregisterScopedCommand } from '@/lib/commands';
import { useActiveEditorStore } from '@/lib/stores/active-editor';
import { useKeymapStore } from '@/lib/stores/keymap';

type MilkdownEditorProps = {
  path: string;
  initialContent: string;
  onError: (message: string) => void;
};

type PresetBinding = {
  id: string;
  // ctx slice for the owning $useKeymap plugin, e.g. headingKeymap.key
  keymapKey: any;
  // action name within that slice, e.g. 'TurnIntoH1'
  action: string;
  // The preset's exported command plugin (e.g. toggleStrongCommand).
  // IMPORTANT: command.key does not exist until Milkdown has actually run
  // this plugin's setup for a live editor -- it's undefined at module
  // load. Don't build callCommand(command.key) here; resolve it lazily
  // via run() at invocation time, once an editor exists.
  command: { key: any };
  payload?: unknown;
};

function run(binding: PresetBinding) {
  return callCommand(binding.command.key, binding.payload);
}

const HEADING_BINDINGS: PresetBinding[] = Array.from({ length: 6 }, (_, i) => {
  const level = i + 1;
  return {
    id: `edit.heading${level}`,
    keymapKey: headingKeymap.key,
    action: `TurnIntoH${level}`,
    command: wrapInHeadingCommand,
    payload: level,
  };
});

const PRESET_BINDINGS: PresetBinding[] = [
  ...HEADING_BINDINGS,
  // Block elements
  {
    id: 'edit.blockquote',
    keymapKey: blockquoteKeymap.key,
    action: 'WrapInBlockquote',
    command: wrapInBlockquoteCommand,
  },
  {
    id: 'edit.bullet_list',
    keymapKey: bulletListKeymap.key,
    action: 'WrapInBulletList',
    command: wrapInBulletListCommand,
  },
  {
    id: 'edit.ordered_list',
    keymapKey: orderedListKeymap.key,
    action: 'WrapInOrderedList',
    command: wrapInOrderedListCommand,
  },
  {
    id: 'edit.code_block',
    keymapKey: codeBlockKeymap.key,
    action: 'CreateCodeBlock',
    command: createCodeBlockCommand,
  },
  {
    id: 'edit.hard_break',
    keymapKey: hardbreakKeymap.key,
    action: 'InsertHardbreak',
    command: insertHardbreakCommand,
  },
  {
    id: 'edit.paragraph',
    keymapKey: paragraphKeymap.key,
    action: 'TurnIntoText',
    command: turnIntoTextCommand,
  },
  // Text formatting
  {
    id: 'edit.bold',
    keymapKey: strongKeymap.key,
    action: 'ToggleBold',
    command: toggleStrongCommand,
  },
  {
    id: 'edit.italic',
    keymapKey: emphasisKeymap.key,
    action: 'ToggleEmphasis',
    command: toggleEmphasisCommand,
  },
  {
    id: 'edit.inline_code',
    keymapKey: inlineCodeKeymap.key,
    action: 'ToggleInlineCode',
    command: toggleInlineCodeCommand,
  },
  // GFM
  {
    id: 'edit.strikethrough',
    keymapKey: strikethroughKeymap.key,
    action: 'ToggleStrikethrough',
    command: toggleStrikethroughCommand,
  },
];

const PRESET_BINDINGS_BY_KEYMAP = PRESET_BINDINGS.reduce((map, binding) => {
  const group = map.get(binding.keymapKey) ?? [];
  group.push(binding);
  map.set(binding.keymapKey, group);
  return map;
}, new Map<any, PresetBinding[]>());

const MilkdownEditor: React.FC<MilkdownEditorProps> = ({
  path,
  initialContent,
  onError,
}) => {
  const instanceId = useId();
  const loaded = useKeymapStore((s) => s.loaded);

  const { get, loading } = useEditor(
    (root) => {
      if (!loaded) return undefined;

      return Editor.make()
        .config((ctx) => {
          ctx.set(rootCtx, root);
          ctx.set(defaultValueCtx, initialContent);
          ctx.get(listenerCtx).markdownUpdated((_ctx, markdown) => {
            commands
              .writeFile(path, markdown)
              .catch((err) => onError(String(err)));
          });

          for (const [keymapKey, bindings] of PRESET_BINDINGS_BY_KEYMAP) {
            const patch = {
              ...(ctx.get(keymapKey) as Record<
                string,
                { shortcuts: string[] }
              >),
            };
            for (const { action } of bindings) {
              patch[action] = { shortcuts: [] };
            }
            ctx.set(keymapKey, patch);
          }
        })
        .use(listener)
        .use(commonmark)
        .use(gfm)
        .use(history);
    },
    [path, loaded],
  );

  useEffect(() => {
    if (loading) return;
    const editor = get();
    if (!editor) return;

    for (const binding of PRESET_BINDINGS) {
      registerScopedCommand(instanceId, binding.id, () => {
        // binding.command.key is resolved now, not at module load --
        // by this point the editor has run commonmark/gfm's setup and
        // populated it.
        editor.action(run(binding));
      });
    }

    registerScopedCommand(instanceId, 'native.undo', () => {
      editor.action(callCommand(undoCommand.key));
    });
    registerScopedCommand(instanceId, 'native.redo', () => {
      editor.action(callCommand(redoCommand.key));
    });

    let dom: HTMLElement | null = null;
    const handleFocus = () =>
      useActiveEditorStore.getState().setActiveEditor(instanceId);

    // Intentionally no blur handler here. Clicking the Edit menu (native
    // menubar, or anything outside this editor) moves DOM focus away
    // from `dom` first, firing blur, before the menu's click/invoke
    // handler actually runs -- so a blur-driven "clear active editor"
    // would race ahead and null out the target before Undo/Redo ever
    // gets dispatched. Instead we let `activeEditorId` stay sticky: it's
    // only ever overwritten by another editor's own `handleFocus`, or
    // cleared below on unmount. That keeps this editor as the scoped
    // command target even while focus is elsewhere.
    editor.action((ctx) => {
      dom = ctx.get(editorViewCtx).dom;
      dom.setAttribute('data-command-surface', 'true');
      dom.addEventListener('focus', handleFocus);

      if (document.activeElement === dom) {
        handleFocus();
      }
    });

    return () => {
      dom?.removeEventListener('focus', handleFocus);
      for (const { id } of PRESET_BINDINGS) {
        unregisterScopedCommand(instanceId, id);
      }

      unregisterScopedCommand(instanceId, 'native.undo');
      unregisterScopedCommand(instanceId, 'native.redo');

      // Only clear here, on unmount -- so a closed/unmounted editor never
      // stays the active command target.
      if (useActiveEditorStore.getState().activeEditorId === instanceId) {
        useActiveEditorStore.getState().setActiveEditor(null);
      }
    };
  }, [loading, get, instanceId]);

  if (!loaded) {
    return <div className='p-4 text-muted-foreground'>Loading editor…</div>;
  }

  return <Milkdown />;
};

export const MilkdownEditorWrapper: React.FC<MilkdownEditorProps> = (props) => (
  <MilkdownProvider>
    <MilkdownEditor {...props} />
  </MilkdownProvider>
);
