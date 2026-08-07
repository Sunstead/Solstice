import { useEffect, useId, useMemo } from 'react';
import {
  Editor,
  rootCtx,
  defaultValueCtx,
  editorViewCtx,
} from '@milkdown/kit/core';
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
import { buildDynamicEditKeymap } from '@/lib/dynamic-keymap';
import { toProseMirrorFormat } from '@/lib/accelerator';
import type { CommandMeta } from '@/bindings';

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
  // callCommand(...) result; invoke via editor.action(run)
  run: (ctx: any) => boolean;
};

const PRESET_BINDINGS: PresetBinding[] = [
  // Headings
  {
    id: 'edit.heading1',
    keymapKey: headingKeymap.key,
    action: 'TurnIntoH1',
    run: callCommand(wrapInHeadingCommand.key, 1),
  },
  {
    id: 'edit.heading2',
    keymapKey: headingKeymap.key,
    action: 'TurnIntoH2',
    run: callCommand(wrapInHeadingCommand.key, 2),
  },
  {
    id: 'edit.heading3',
    keymapKey: headingKeymap.key,
    action: 'TurnIntoH3',
    run: callCommand(wrapInHeadingCommand.key, 3),
  },
  {
    id: 'edit.heading4',
    keymapKey: headingKeymap.key,
    action: 'TurnIntoH4',
    run: callCommand(wrapInHeadingCommand.key, 4),
  },
  {
    id: 'edit.heading5',
    keymapKey: headingKeymap.key,
    action: 'TurnIntoH5',
    run: callCommand(wrapInHeadingCommand.key, 5),
  },
  {
    id: 'edit.heading6',
    keymapKey: headingKeymap.key,
    action: 'TurnIntoH6',
    run: callCommand(wrapInHeadingCommand.key, 6),
  },
  // Block elements
  {
    id: 'edit.blockquote',
    keymapKey: blockquoteKeymap.key,
    action: 'WrapInBlockquote',
    run: callCommand(wrapInBlockquoteCommand.key),
  },
  {
    id: 'edit.bullet_list',
    keymapKey: bulletListKeymap.key,
    action: 'WrapInBulletList',
    run: callCommand(wrapInBulletListCommand.key),
  },
  {
    id: 'edit.ordered_list',
    keymapKey: orderedListKeymap.key,
    action: 'WrapInOrderedList',
    run: callCommand(wrapInOrderedListCommand.key),
  },
  {
    id: 'edit.code_block',
    keymapKey: codeBlockKeymap.key,
    action: 'CreateCodeBlock',
    run: callCommand(createCodeBlockCommand.key),
  },
  {
    id: 'edit.hard_break',
    keymapKey: hardbreakKeymap.key,
    action: 'InsertHardbreak',
    run: callCommand(insertHardbreakCommand.key),
  },
  {
    id: 'edit.paragraph',
    keymapKey: paragraphKeymap.key,
    action: 'TurnIntoText',
    run: callCommand(turnIntoTextCommand.key),
  },
  // Text formatting
  {
    id: 'edit.bold',
    keymapKey: strongKeymap.key,
    action: 'ToggleBold',
    run: callCommand(toggleStrongCommand.key),
  },
  {
    id: 'edit.italic',
    keymapKey: emphasisKeymap.key,
    action: 'ToggleEmphasis',
    run: callCommand(toggleEmphasisCommand.key),
  },
  {
    id: 'edit.inline_code',
    keymapKey: inlineCodeKeymap.key,
    action: 'ToggleInlineCode',
    run: callCommand(toggleInlineCodeCommand.key),
  },
  // GFM
  {
    id: 'edit.strikethrough',
    keymapKey: strikethroughKeymap.key,
    action: 'ToggleStrikethrough',
    run: callCommand(toggleStrikethroughCommand.key),
  },
];

const PRESET_OWNED_IDS = new Set(PRESET_BINDINGS.map((b) => b.id));

function findAccelerator(cmds: CommandMeta[], id: string): string | null {
  return cmds.find((c) => c.id === id)?.default_accelerator ?? null;
}

const MilkdownEditor: React.FC<MilkdownEditorProps> = ({
  path,
  initialContent,
  onError,
}) => {
  const instanceId = useId();

  const loaded = useKeymapStore((s) => s.loaded);
  const allCmds = useKeymapStore((s) => s.commands);
  const editCmds = useMemo(
    () => allCmds.filter((c) => c.group === 'edit'),
    [allCmds],
  );

  const keymapFingerprint = useMemo(
    () =>
      editCmds.map((c) => `${c.id}:${c.default_accelerator ?? ''}`).join('|'),
    [editCmds],
  );

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

          const byKeymap = new Map<any, PresetBinding[]>();
          for (const binding of PRESET_BINDINGS) {
            const group = byKeymap.get(binding.keymapKey) ?? [];
            group.push(binding);
            byKeymap.set(binding.keymapKey, group);
          }

          for (const [keymapKey, bindings] of byKeymap) {
            const patch = {
              ...(ctx.get(keymapKey) as Record<
                string,
                { shortcuts: string[] }
              >),
            };
            for (const { action, id } of bindings) {
              const accel = findAccelerator(editCmds, id);
              patch[action] = {
                shortcuts: accel ? [toProseMirrorFormat(accel)] : [],
              };
            }
            ctx.set(keymapKey, patch);
          }
        })
        .use(listener)
        .use(commonmark)
        .use(gfm)
        .use(
          buildDynamicEditKeymap(
            editCmds.filter((c) => !PRESET_OWNED_IDS.has(c.id)),
          ),
        );
    },
    [path, loaded, keymapFingerprint],
  );

  useEffect(() => {
    if (loading) return;
    const editor = get();
    if (!editor) return;

    for (const { id, run } of PRESET_BINDINGS) {
      registerScopedCommand(instanceId, id, () => {
        editor.action(run);
      });
    }

    let dom: HTMLElement | null = null;
    const handleFocus = () =>
      useActiveEditorStore.getState().setActiveEditor(instanceId);
    const handleBlur = () => {
      if (useActiveEditorStore.getState().activeEditorId === instanceId) {
        useActiveEditorStore.getState().setActiveEditor(null);
      }
    };
    editor.action((ctx) => {
      dom = ctx.get(editorViewCtx).dom;
      dom.addEventListener('focus', handleFocus);
      dom.addEventListener('blur', handleBlur);
    });

    return () => {
      dom?.removeEventListener('focus', handleFocus);
      dom?.removeEventListener('blur', handleBlur);
      for (const { id } of PRESET_BINDINGS) {
        unregisterScopedCommand(instanceId, id);
      }
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
