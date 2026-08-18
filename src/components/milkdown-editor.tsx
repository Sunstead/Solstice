import { useEffect, useId } from 'react';
import type { Ctx } from '@milkdown/kit/ctx';
import {
  Editor,
  rootCtx,
  defaultValueCtx,
  editorViewCtx,
  commandsCtx,
} from '@milkdown/kit/core';
import {
  history,
  redoCommand,
  undoCommand,
} from '@milkdown/kit/plugin/history';
import { clipboard } from '@milkdown/kit/plugin/clipboard';
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
import { callCommand, $prose } from '@milkdown/kit/utils';
import { Plugin, AllSelection } from '@milkdown/kit/prose/state';
import { Milkdown, MilkdownProvider, useEditor } from '@milkdown/react';
import { commands, CommandId } from '@/bindings';
import { registerScopedCommand, unregisterScopedCommand } from '@/lib/commands';
import { useActiveEditorStore } from '@/lib/stores/active-editor';
import { useKeymapStore } from '@/lib/stores/keymap';
import { wikilink, useWikilinkIndexSync } from '@/lib/wikilink';
import '@/styles/wikilink.css';

type MilkdownEditorProps = {
  path: string;
  initialContent: string;
  onError: (message: string) => void;
};

type PresetBinding = {
  id: CommandId;
  keymapKey: any;
  action: string;
  command: { key: any };
  payload?: unknown;
};

function run(binding: PresetBinding) {
  return callCommand(binding.command.key, binding.payload);
}

function canRun(key: any, payload?: unknown) {
  return (ctx: Ctx) => {
    try {
      const view = ctx.get(editorViewCtx);
      const command = ctx.get(commandsCtx).get(key)(payload);
      return command(view.state, undefined, view);
    } catch (err) {
      console.error('Failed to check command availability', err);
      return false;
    }
  };
}

const HEADING_BINDINGS: PresetBinding[] = Array.from({ length: 6 }, (_, i) => {
  const level = i + 1;
  return {
    id: `edit.heading${level}` as CommandId,
    keymapKey: headingKeymap.key,
    action: `TurnIntoH${level}`,
    command: wrapInHeadingCommand,
    payload: level,
  };
});

const PRESET_BINDINGS: PresetBinding[] = [
  ...HEADING_BINDINGS,
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

      const commandStateTracker = $prose(
        () =>
          new Plugin({
            view: () => ({
              update: (view, prevState) => {
                if (
                  view.state.selection.eq(prevState.selection) &&
                  view.state.doc.eq(prevState.doc)
                ) {
                  return;
                }
                if (
                  useActiveEditorStore.getState().activeEditorId === instanceId
                ) {
                  useActiveEditorStore.getState().bumpCommandVersion();
                }
              },
            }),
          }),
      );

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
        .use(history)
        .use(clipboard)
        .use(wikilink)
        .use(commandStateTracker);
    },
    [path, loaded],
  );

  useEffect(() => {
    if (loading) return;
    const editor = get();
    if (!editor) return;

    const focusView = () => {
      editor.action((ctx) => {
        ctx.get(editorViewCtx).focus();
      });
    };

    const pasteFromClipboard = async () => {
      focusView();
      const dataTransfer = new DataTransfer();
      try {
        const items = await navigator.clipboard.read();
        for (const item of items) {
          for (const type of item.types) {
            if (type !== 'text/plain' && type !== 'text/html') continue;
            const blob = await item.getType(type);
            dataTransfer.setData(type, await blob.text());
          }
        }
      } catch {
        try {
          dataTransfer.setData(
            'text/plain',
            await navigator.clipboard.readText(),
          );
        } catch (err) {
          console.error('Paste failed: clipboard unavailable', err);
          return;
        }
      }
      if (dataTransfer.types.length === 0) return;
      editor.action((ctx) => {
        const view = ctx.get(editorViewCtx);

        view.dom.dispatchEvent(
          new ClipboardEvent('paste', {
            clipboardData: dataTransfer,
            bubbles: true,
            cancelable: true,
          }),
        );
      });
    };

    for (const binding of PRESET_BINDINGS) {
      registerScopedCommand(
        instanceId,
        binding.id,
        () => {
          focusView();
          editor.action(run(binding));
        },
        () => editor.action(canRun(binding.command.key, binding.payload)),
      );
    }

    registerScopedCommand(
      instanceId,
      'native.undo',
      () => {
        editor.action(callCommand(undoCommand.key));
      },
      () => editor.action(canRun(undoCommand.key)),
    );
    registerScopedCommand(
      instanceId,
      'native.redo',
      () => {
        editor.action(callCommand(redoCommand.key));
      },
      () => editor.action(canRun(redoCommand.key)),
    );

    registerScopedCommand(
      instanceId,
      'native.cut',
      () => {
        focusView();
        document.execCommand('cut');
      },
      () =>
        editor.action((ctx) => !ctx.get(editorViewCtx).state.selection.empty),
    );
    registerScopedCommand(
      instanceId,
      'native.copy',
      () => {
        focusView();
        document.execCommand('copy');
      },
      () =>
        editor.action((ctx) => !ctx.get(editorViewCtx).state.selection.empty),
    );
    registerScopedCommand(instanceId, 'native.paste', () => {
      void pasteFromClipboard();
    });

    registerScopedCommand(instanceId, 'native.select_all', () => {
      editor.action((ctx) => {
        const view = ctx.get(editorViewCtx);
        view.dispatch(
          view.state.tr.setSelection(new AllSelection(view.state.doc)),
        );
      });
      focusView();
    });

    let dom: HTMLElement | null = null;
    const handleFocus = () =>
      useActiveEditorStore.getState().setActiveEditor(instanceId);

    editor.action((ctx) => {
      dom = ctx.get(editorViewCtx).dom;
      dom.setAttribute('data-command-surface', 'true');
      dom.setAttribute('data-editor-id', instanceId);
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
      unregisterScopedCommand(instanceId, 'native.cut');
      unregisterScopedCommand(instanceId, 'native.copy');
      unregisterScopedCommand(instanceId, 'native.paste');
      unregisterScopedCommand(instanceId, 'native.select_all');

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

export const MilkdownEditorWrapper: React.FC<MilkdownEditorProps> = (props) => {
  useWikilinkIndexSync();

  return (
    <MilkdownProvider>
      <MilkdownEditor {...props} />
    </MilkdownProvider>
  );
};
