import { useCallback, useEffect, useId, useRef } from 'react';
import type { Ctx } from '@milkdown/kit/ctx';
import {
  Editor,
  rootCtx,
  defaultValueCtx,
  editorViewCtx,
  commandsCtx,
  parserCtx,
  serializerCtx,
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
import { Plugin, AllSelection, TextSelection } from '@milkdown/kit/prose/state';
import { Slice } from '@milkdown/kit/prose/model';
import { Milkdown, MilkdownProvider, useEditor } from '@milkdown/react';
import { CommandId } from '@/bindings';
import { createAutosaver, type Autosaver } from '@/lib/autosave';
import { registerScopedCommand, unregisterScopedCommand } from '@/lib/commands';
import { useActiveEditorStore } from '@/lib/stores/active-editor';
import { useKeymapStore } from '@/lib/stores/keymap';
import { wikilink, useWikilinkIndexSync } from '@/lib/wikilink';
import { ExternalChangeBar } from '@/components/external-change-bar';
import { useExternalFileChanges } from '@/hooks/use-external-file-changes';
import { useLayout } from '@/hooks/use-layout';
import {
  abandonPendingWrites,
  clearAbandoned,
} from '@/lib/stores/external-changes';
import '@/styles/wikilink.css';

/**
 * Marks a transaction as an external reload rather than a user edit, so the
 * dirty tracker ignores it. Paired with `addToHistory: false`, which
 * @milkdown/plugin-listener treats as a suppression signal -- a transaction
 * carrying it never reaches `markdownUpdated`, and so never schedules a write.
 * That is what makes replacing the document in place safe from a write-back
 * loop, with no flags or timing windows involved.
 */
const EXTERNAL_RELOAD = 'solstice-external-reload';

/**
 * The editor scrolls inside FileEditor's ScrollArea viewport, not inside
 * `view.dom`, so preserving scroll position means finding that ancestor.
 */
function findScrollParent(from: HTMLElement): HTMLElement | null {
  let node: HTMLElement | null = from.parentElement;

  while (node) {
    const { overflowY } = getComputedStyle(node);
    if (
      (overflowY === 'auto' || overflowY === 'scroll') &&
      node.scrollHeight > node.clientHeight
    ) {
      return node;
    }
    node = node.parentElement;
  }

  return null;
}

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
  const autosaver = useRef<Autosaver | null>(null);

  const { get, loading } = useEditor(
    (root) => {
      if (!loaded) return undefined;

      const saver = createAutosaver(path, initialContent, onError);
      autosaver.current = saver;

      // Marks the file dirty synchronously with the transaction. Milkdown's
      // listener debounces markdownUpdated by 200ms, so driving the tab's
      // saving indicator off the write schedule would leave it trailing every
      // edit by that much.
      //
      // Written as appendTransaction rather than a view update because only
      // this form can see transaction metadata -- an external reload replaces
      // the whole document and must not count as an edit.
      const dirtyTracker = $prose(
        () =>
          new Plugin({
            appendTransaction: (transactions) => {
              const edited = transactions.some(
                (tr) =>
                  tr.docChanged &&
                  // Mirrors the listener's own filter. A transaction it skips
                  // never reaches markdownUpdated, so it can never schedule a
                  // write -- counting one as an edit marks the file unsaved
                  // with no way to ever clear it. Milkdown normalizes the
                  // document at load with exactly such a transaction, which
                  // is what used to pin the tab's saving spinner on from the
                  // moment a file was opened.
                  tr.getMeta('addToHistory') !== false &&
                  !tr.getMeta(EXTERNAL_RELOAD),
              );
              if (edited) saver.markDirty();
              return null;
            },
          }),
      );

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
            saver.schedule(markdown);
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
        .use(dirtyTracker)
        .use(commandStateTracker);
    },
    [path, loaded],
  );

  // A debounced write must not outlive the editor that scheduled it: flush on
  // a path change and when the window is going away, and dispose on unmount so
  // a closed tab leaves no saving indicator behind.
  useEffect(() => {
    const flushPending = () => autosaver.current?.flush();
    window.addEventListener('pagehide', flushPending);
    return () => {
      window.removeEventListener('pagehide', flushPending);
      autosaver.current?.dispose();
    };
  }, [path]);

  /**
   * Swaps in new content without remounting, preserving cursor and scroll.
   *
   * Milkdown's own `replaceAll` can't be used here: its flush path recreates
   * the EditorState (losing undo history *and* selection), and its non-flush
   * path dispatches a transaction of its own, so there is nowhere to attach
   * the meta that keeps this from registering as an edit.
   */
  const applyDiskContent = useCallback(
    (markdown: string) => {
      const editor = get();
      if (!editor) return;

      editor.action((ctx: Ctx) => {
        const view = ctx.get(editorViewCtx);
        const doc = ctx.get(parserCtx)(markdown);
        if (!doc) return;

        const { state } = view;
        const anchor = Math.min(state.selection.anchor, doc.content.size);
        const scroller = findScrollParent(view.dom as HTMLElement);
        const scrollTop = scroller?.scrollTop ?? 0;
        const hadFocus = view.hasFocus();

        const tr = state.tr
          .replace(0, state.doc.content.size, new Slice(doc.content, 0, 0))
          .setMeta(EXTERNAL_RELOAD, true)
          .setMeta('addToHistory', false);

        // `replace` maps the selection to near the end of the document, so it
        // has to be set back explicitly. Clamping the old offset is the
        // honest best effort -- an exact logical position isn't recoverable
        // across an arbitrary external edit.
        try {
          tr.setSelection(TextSelection.near(tr.doc.resolve(anchor), 1));
        } catch {
          // Document too short for the old offset; leave the default.
        }

        view.dispatch(tr);

        // dispatch updates the DOM synchronously, so this lands after layout.
        if (scroller) scroller.scrollTop = scrollTop;
        if (hadFocus) view.focus();
      });
    },
    [get],
  );

  /**
   * Whether disk and buffer mean the same thing. Compared through the
   * serializer rather than as raw text: Milkdown normalizes markdown, so a
   * hand-edited file would otherwise look changed on every single check.
   */
  const matchesBuffer = useCallback(
    (diskText: string) => {
      const editor = get();
      if (!editor) return false;

      return (
        editor.action((ctx: Ctx) => {
          const doc = ctx.get(parserCtx)(diskText);
          if (!doc) return false;

          const serialize = ctx.get(serializerCtx);
          return serialize(doc) === serialize(ctx.get(editorViewCtx).state.doc);
        }) ?? false
      );
    },
    [get],
  );

  const getMarkdown = useCallback(() => {
    const editor = get();
    if (!editor) return null;

    return editor.action((ctx: Ctx) =>
      ctx.get(serializerCtx)(ctx.get(editorViewCtx).state.doc),
    );
  }, [get]);

  const { status, reload, keepMine, dismiss } = useExternalFileChanges({
    path,
    ready: !loading,
    isDirty: () => autosaver.current?.isDirty() ?? false,
    getLastWritten: () => autosaver.current?.getLastWritten() ?? initialContent,
    matchesBuffer,
    applyDiskContent,
    adopt: (text) => autosaver.current?.adopt(text),
    hold: () => autosaver.current?.hold(),
    release: () => autosaver.current?.release(),
  });

  // Writing the buffer back immediately is what actually resolves the
  // divergence. Just dismissing would leave a user who then stops typing
  // permanently out of sync, with the bar returning on the next focus resync.
  const handleKeepMine = useCallback(() => {
    const markdown = getMarkdown();
    keepMine();

    if (markdown === null) return;
    // The file was abandoned when it vanished, to stop stale flushes from
    // resurrecting it. Saving it back is the user explicitly asking for
    // exactly that, so lift the mark first.
    clearAbandoned(path);
    autosaver.current?.schedule(markdown);
    autosaver.current?.flush();
  }, [getMarkdown, keepMine, path]);

  const handleCloseTab = useCallback(() => {
    abandonPendingWrites(path);
    dismiss();
    useLayout.getState().closeFileTab(path);
  }, [dismiss, path]);

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

  return (
    <>
      {status.kind !== 'none' && (
        <ExternalChangeBar
          variant={status.kind}
          onReload={reload}
          onKeepMine={handleKeepMine}
          onClose={handleCloseTab}
        />
      )}
      <Milkdown />
    </>
  );
};

export const MilkdownEditorWrapper: React.FC<MilkdownEditorProps> = (props) => {
  useWikilinkIndexSync();

  return (
    <MilkdownProvider>
      <MilkdownEditor {...props} />
    </MilkdownProvider>
  );
};
