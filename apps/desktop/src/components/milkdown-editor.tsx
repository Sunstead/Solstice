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
  bulletListSchema,
  listItemKeymap,
  listItemSchema,
  liftListItemCommand,
  sinkListItemCommand,
} from '@milkdown/kit/preset/commonmark';
import {
  gfm,
  toggleStrikethroughCommand,
  strikethroughKeymap,
} from '@milkdown/kit/preset/gfm';
import { listener, listenerCtx } from '@milkdown/kit/plugin/listener';
import { callCommand, $prose } from '@milkdown/kit/utils';
import { Plugin, AllSelection, TextSelection } from '@milkdown/kit/prose/state';
import type { EditorView } from '@milkdown/kit/prose/view';
import { Slice } from '@milkdown/kit/prose/model';
import { Milkdown, MilkdownProvider, useEditor } from '@milkdown/react';
import {
  ProsemirrorAdapterProvider,
  useNodeViewFactory,
} from '@prosemirror-adapter/react';
import { CommandId } from '@/bindings';
import { createAutosaver, type Autosaver } from '@/lib/autosave';
import { registerScopedCommand, unregisterScopedCommand } from '@/lib/commands';
import { useActiveEditorStore } from '@/lib/stores/active-editor';
import { useKeymapStore } from '@/lib/stores/keymap';
import { wikilink, useWikilinkIndexSync } from '@/lib/wikilink';
import { createEditorFeatures, editorOuterMarks } from '@/lib/editor/plugins';
import { insertImagesFromDialog } from '@/lib/editor/insert-image';
import { toggleTaskList } from '@/lib/editor/list-commands';
import { toggleHighlightCommand } from '@/lib/highlight';
import { blockIdOf, findAnchor, newBlockId } from '@/lib/blockid';
import { clearAnchor, useAnchorRequest } from '@/lib/stores/anchor';
import { wikilinkFor } from '@/lib/entry-actions';
import { pickFile } from '@/lib/stores/note-picker';
import { EditorNotePathContext } from '@/components/editor/editor-file-context';
import { ExternalChangeBar } from '@/components/external-change-bar';
import { SaveFailedBar } from '@/components/save-failed-bar';
import { ReviewBar } from '@/components/sync/review-bar';
import { useReviewFor } from '@/lib/stores/sync';
import { useSaveFailure } from '@/lib/stores/save-status';
import { findPlugin, getFindState, setFindQuery, stepFindMatch } from '@/lib/find/plugin';
import { useFindStore } from '@/lib/stores/find';
import { useExternalFileChanges } from '@/hooks/use-external-file-changes';
import { useLayout } from '@/hooks/use-layout';
import {
  abandonPendingWrites,
  clearAbandoned,
} from '@/lib/stores/external-changes';
import '@/styles/wikilink.css';
import '@/styles/find.css';
import '@/styles/image.css';
import '@/styles/embed.css';
import '@/styles/code-block.css';
import '@/styles/math.css';
import '@/styles/callout.css';
import '@/styles/frontmatter.css';
import '@/styles/highlight.css';
import '@/styles/task-list.css';
import '@/styles/table.css';

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
  /**
   * Populated with a "commit and write right now" callback once the editor is
   * ready, and cleared back to `null` on unmount. Plain prop rather than a
   * `forwardRef` handle: the one caller that needs this (a canvas file card)
   * already has nowhere more natural to keep a ref, and every other caller
   * simply never passes it.
   */
  flushRef?: React.MutableRefObject<(() => void) | null>;
};

type PresetBinding = {
  id: CommandId;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Milkdown command keys are typed per command
  keymapKey: any;
  action: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Milkdown command keys are typed per command
  command: { key: any };
  payload?: unknown;
};

function run(binding: PresetBinding) {
  return callCommand(binding.command.key, binding.payload);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Milkdown command keys are typed per command
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
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Milkdown command keys are typed per command
}, new Map<any, PresetBinding[]>());

const MilkdownEditor: React.FC<MilkdownEditorProps> = ({
  path,
  initialContent,
  flushRef,
}) => {
  const instanceId = useId();
  const loaded = useKeymapStore((s) => s.loaded);
  // Memoized by the adapter, so listing it as a dependency below does not
  // rebuild the editor on every render.
  const nodeViewFactory = useNodeViewFactory();
  const autosaver = useRef<Autosaver | null>(null);

  const { get, loading } = useEditor(
    (root) => {
      if (!loaded) return undefined;

      const saver = createAutosaver(path, initialContent);
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

      // Keeps the find bar's "3/12" honest. Reporting from the view rather
      // than from the effect that pushes the query down means an edit that
      // creates or destroys a match updates the count too, not just a
      // retyped query.
      const findReporter = $prose(
        () =>
          new Plugin({
            view: () => ({
              update: (view) => {
                const store = useFindStore.getState();
                if (store.openPath !== path) return;

                const found = getFindState(view.state);
                const matchCount = found?.matches.length ?? 0;
                const activeIndex = found?.activeIndex ?? -1;

                if (
                  matchCount !== store.matchCount ||
                  activeIndex !== store.activeIndex
                ) {
                  store.reportMatches(matchCount, activeIndex);
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
          // Mod-] and Mod-[ are `edit.indent`/`edit.outdent` now; Tab stays.
          ctx.update(listItemKeymap.key, (keys) => ({
            ...keys,
            SinkListItem: { ...keys.SinkListItem, shortcuts: ['Tab'] },
            LiftListItem: { ...keys.LiftListItem, shortcuts: ['Shift-Tab'] },
          }));
        })
        .use(listener)
        .use(editorOuterMarks())
        .use(commonmark)
        .use(gfm)
        .use(history)
        .use(clipboard)
        .use(wikilink)
        .use(createEditorFeatures({ notePath: path, nodeViewFactory }))
        .use(dirtyTracker)
        .use(commandStateTracker)
        .use(findPlugin)
        .use(findReporter);
    },
    [path, loaded, nodeViewFactory],
  );

  // A debounced write must not outlive the editor that scheduled it: dispose
  // (which flushes) on a path change and on unmount, so a closed tab leaves no
  // saving indicator behind. The autosaver flushes when the page hides.
  useEffect(() => {
    return () => autosaver.current?.dispose();
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

  // Populates the caller's flush handle, when it asked for one. Reads the
  // *live* document via `getMarkdown()` rather than waiting on
  // `markdownUpdated`'s ~200ms debounce, so a caller that flushes right before
  // unmounting this editor -- a canvas card leaving edit mode -- gets the
  // truly latest keystrokes rather than whatever the debounce had already
  // reported.
  useEffect(() => {
    if (!flushRef) return;

    flushRef.current = () => {
      const markdown = getMarkdown();
      if (markdown === null) return;
      autosaver.current?.schedule(markdown);
      autosaver.current?.flush();
    };

    return () => {
      flushRef.current = null;
    };
  }, [flushRef, getMarkdown]);

  const review = useReviewFor(path);

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
    flush: () => {
      const markdown = getMarkdown();
      if (markdown === null) return;
      autosaver.current?.schedule(markdown);
      autosaver.current?.flush();
    },
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
            // An image has to arrive as a file rather than as data: the paste
            // handler that turns one into an attachment reads `files`.
            if (type.startsWith('image/')) {
              const blob = await item.getType(type);
              dataTransfer.items.add(new File([blob], '', { type }));
              continue;
            }
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

    registerScopedCommand(instanceId, 'edit.find', () => {
      useFindStore.getState().openFor(path);
    });

    registerScopedCommand(instanceId, 'edit.insert_image', () => {
      void insertImagesFromDialog((fn) => editor.action(fn), path);
    });

    registerScopedCommand(
      instanceId,
      'edit.highlight',
      () => {
        focusView();
        editor.action(callCommand(toggleHighlightCommand.key));
      },
      () => editor.action(canRun(toggleHighlightCommand.key)),
    );
    registerScopedCommand(
      instanceId,
      'edit.indent',
      () => {
        focusView();
        editor.action(callCommand(sinkListItemCommand.key));
      },
      () => editor.action(canRun(sinkListItemCommand.key)),
    );
    registerScopedCommand(
      instanceId,
      'edit.outdent',
      () => {
        focusView();
        editor.action(callCommand(liftListItemCommand.key));
      },
      () => editor.action(canRun(liftListItemCommand.key)),
    );

    const taskCommand = (ctx: Ctx) =>
      toggleTaskList(listItemSchema.type(ctx), bulletListSchema.type(ctx));
    registerScopedCommand(
      instanceId,
      'edit.task_list',
      () => {
        focusView();
        editor.action((ctx) => {
          const view = ctx.get(editorViewCtx);
          taskCommand(ctx)(view.state, view.dispatch);
        });
      },
      () => editor.action((ctx) => taskCommand(ctx)(ctx.get(editorViewCtx).state)),
    );

    registerScopedCommand(instanceId, 'edit.copy_block_link', () => {
      editor.action((ctx) => {
        const view = ctx.get(editorViewCtx);
        const { $from } = view.state.selection;
        if (!$from.parent.isTextblock) return;
        let id = blockIdOf($from.parent);
        if (!id) {
          id = newBlockId();
          view.dispatch(view.state.tr.insertText(` ^${id}`, $from.end()));
        }
        void navigator.clipboard
          .writeText(wikilinkFor(path).replace(/]]$/, `#^${id}]]`))
          .catch((error) => console.error('Copy link to block failed', error));
      });
    });

    registerScopedCommand(instanceId, 'edit.insert_wikilink', async () => {
      const picked = await pickFile();
      focusView();
      if (!picked) return;
      editor.action((ctx) => {
        const view = ctx.get(editorViewCtx);
        view.dispatch(view.state.tr.insertText(wikilinkFor(picked)).scrollIntoView());
      });
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

      unregisterScopedCommand(instanceId, 'edit.find');
      unregisterScopedCommand(instanceId, 'edit.insert_image');
      unregisterScopedCommand(instanceId, 'edit.highlight');
      unregisterScopedCommand(instanceId, 'edit.indent');
      unregisterScopedCommand(instanceId, 'edit.outdent');
      unregisterScopedCommand(instanceId, 'edit.task_list');
      unregisterScopedCommand(instanceId, 'edit.insert_wikilink');
      unregisterScopedCommand(instanceId, 'edit.copy_block_link');
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
  }, [loading, get, instanceId, path]);

  // --- find in file -------------------------------------------------------
  // The store holds the query; the plugin holds the matches. These effects are
  // the only traffic between them, in one direction each.

  const findOpen = useFindStore((s) => s.openPath === path);
  const findQuery = useFindStore((s) => s.query);
  const findCaseSensitive = useFindStore((s) => s.caseSensitive);
  const findWholeWord = useFindStore((s) => s.wholeWord);
  const findStepRequest = useFindStore((s) => s.stepRequest);
  const findFocusNonce = useFindStore((s) => s.focusNonce);

  const withView = useCallback(
    (fn: (view: EditorView) => void) => {
      const editor = get();
      if (!editor) return;
      editor.action((ctx: Ctx) => fn(ctx.get(editorViewCtx)));
    },
    [get],
  );

  useEffect(() => {
    if (loading) return;

    withView((view) => {
      // A closed bar on a document that was never searched has nothing to
      // clear, and every editor mounts in that state -- so say nothing.
      if (!findOpen && !getFindState(view.state)?.query) return;

      setFindQuery(
        view,
        findOpen
          ? {
              query: findQuery,
              caseSensitive: findCaseSensitive,
              wholeWord: findWholeWord,
            }
          : // Closing has to clear the search, not just hide the bar --
            // otherwise the highlights outlive it.
            null,
      );
    });
  }, [loading, withView, findOpen, findQuery, findCaseSensitive, findWholeWord]);

  useEffect(() => {
    if (loading || !findOpen || !findStepRequest) return;
    withView((view) => stepFindMatch(view, findStepRequest.direction));
  }, [loading, withView, findOpen, findStepRequest]);

  // A link's `#heading` or `#^block`: shown once this note has loaded.
  const anchor = useAnchorRequest((s) => (s.path === path ? s : null));
  useEffect(() => {
    if (loading || !anchor) return;
    clearAnchor();
    withView((view) => {
      const pos = findAnchor(view.state.doc, anchor);
      if (pos === null) return;
      view.dispatch(
        view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(pos + 1))),
      );
      const dom = view.nodeDOM(pos);
      if (!(dom instanceof HTMLElement)) return;
      // A note just opened is still being laid out (and its tab eased in);
      // scrolled any sooner, it lands short.
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          dom.scrollIntoView({ block: 'start' });
          dom.classList.add('solstice-anchor-flash');
          setTimeout(() => dom.classList.remove('solstice-anchor-flash'), 1200);
        }),
      );
    });
  }, [loading, anchor, withView]);

  // Opening over a selection searches for it, the way every editor does.
  // Owned here rather than by the bar because only the editor can read the
  // selection, and keyed on the open counter so asking for find again while
  // the bar is already up re-seeds it.
  useEffect(() => {
    if (loading || !findOpen) return;

    withView((view) => {
      const { from, to, empty } = view.state.selection;
      if (empty) return;

      const text = view.state.doc.textBetween(from, to, ' ');
      // A multi-line selection is a region, not a search term.
      if (text && !text.includes('\n')) useFindStore.getState().setQuery(text);
    });
  }, [loading, withView, findOpen, findFocusNonce]);

  // Closing hands focus back to the document, so typing resumes at the caret
  // -- which stepping through matches has already left on the last one.
  const wasFindOpen = useRef(false);
  useEffect(() => {
    if (wasFindOpen.current && !findOpen) withView((view) => view.focus());
    wasFindOpen.current = findOpen;
  }, [findOpen, withView]);

  const saveFailure = useSaveFailure(path);

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
      {saveFailure && (
        <SaveFailedBar message={saveFailure} onRetry={() => autosaver.current?.retry()} />
      )}
      {review && <ReviewBar review={review} />}
      <Milkdown />
    </>
  );
};

export const MilkdownEditorWrapper: React.FC<MilkdownEditorProps> = (props) => {
  useWikilinkIndexSync();

  // The note path sits outside the adapter on purpose: node views render as
  // portals into the adapter's own tree, so context provided above it reaches
  // them, and they need the path to resolve relative links.
  return (
    <EditorNotePathContext.Provider value={props.path}>
      <ProsemirrorAdapterProvider>
        <MilkdownProvider>
          <MilkdownEditor {...props} />
        </MilkdownProvider>
      </ProsemirrorAdapterProvider>
    </EditorNotePathContext.Provider>
  );
};
