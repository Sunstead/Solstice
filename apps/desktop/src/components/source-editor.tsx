import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { defaultKeymap, history, historyKeymap, indentWithTab, redo, selectAll, undo } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { openSearchPanel, search, searchKeymap } from '@codemirror/search';
import { Annotation, EditorState } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';

import { ExternalChangeBar } from '@/components/external-change-bar';
import { SaveFailedBar } from '@/components/save-failed-bar';
import { ReviewBar } from '@/components/sync/review-bar';
import { useExternalFileChanges } from '@/hooks/use-external-file-changes';
import { useLayout } from '@/hooks/use-layout';
import { createAutosaver, type Autosaver } from '@/lib/autosave';
import { createSearchPanel } from '@/lib/codeblock/search-panel';
import { codeBlockHighlighting } from '@/lib/codeblock/theme';
import { registerScopedCommand, unregisterScopedCommand, type ScopedCommandId } from '@/lib/commands';
import { useActiveEditorStore } from '@/lib/stores/active-editor';
import { registerTextSource } from '@/lib/stores/editor-text';
import { abandonPendingWrites, clearAbandoned } from '@/lib/stores/external-changes';
import { useSaveFailure } from '@/lib/stores/save-status';
import { useReviewFor } from '@/lib/stores/sync';

/** A reload from disk, which mustn't count as an edit. */
const external = Annotation.define<boolean>();

/** Markdown as written: the note's own fonts, syntax tinted, lines wrapped. */
const sourceTheme = EditorView.theme({
  '&': { color: 'var(--foreground)', backgroundColor: 'transparent', fontSize: 'inherit' },
  '&.cm-focused': { outline: 'none' },
  // CodeMirror's base theme sets monospace here.
  '.cm-scroller': { fontFamily: 'inherit', lineHeight: 'inherit' },
  // The rich editor's column and margins (prosemirror.css), so switching
  // doesn't move the text.
  '.cm-content': {
    padding: '4rem 0 var(--editor-pad-bottom, 10rem)',
    caretColor: 'var(--foreground)',
  },
  '.cm-content, .cm-panels-top': {
    paddingLeft: 'max(1rem, calc((100% - var(--editor-measure, 80ch)) / 2))',
    paddingRight: 'max(1rem, calc((100% - var(--editor-measure, 80ch)) / 2))',
  },
  '.cm-line': { padding: '0' },
  '&.cm-focused .cm-cursor': { borderLeftColor: 'var(--foreground)' },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection': {
    backgroundColor: 'color-mix(in oklch, var(--primary) 25%, transparent)',
  },
  '.cm-searchMatch': { backgroundColor: 'color-mix(in oklch, var(--primary) 25%, transparent)' },
  '.cm-panels': { backgroundColor: 'transparent', border: 'none' },
});

/**
 * A note as raw markdown, in CodeMirror: every character as it is in the file,
 * for whatever the rich editor can't show or would normalize. Saving, sync and
 * changes on disk work exactly as they do there.
 */
export function SourceEditor({ path, initialContent }: { path: string; initialContent: string }) {
  const instanceId = useId();
  const autosaver = useRef<Autosaver | null>(null);
  const [view, setView] = useState<EditorView | null>(null);

  // Built in a ref callback (its cleanup tears it down), so the view exists
  // exactly while its element does.
  const attach = useCallback(
    (parent: HTMLDivElement | null) => {
      if (!parent) return;
      const saver = createAutosaver(path, initialContent);
      autosaver.current = saver;

      const editor = new EditorView({
        parent,
        state: EditorState.create({
          doc: initialContent,
          extensions: [
            history(),
            keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab]),
            markdown({ codeLanguages: languages }),
            codeBlockHighlighting,
            sourceTheme,
            EditorView.lineWrapping,
            EditorView.contentAttributes.of({ 'data-command-surface': 'true', spellcheck: 'true' }),
            search({ createPanel: createSearchPanel, top: true }),
            EditorView.updateListener.of((update) => {
              if (!update.docChanged || update.transactions.some((tr) => tr.annotation(external))) return;
              saver.markDirty();
              saver.schedule(update.state.doc.toString());
            }),
          ],
        }),
      });
      const unregisterText = registerTextSource(path, () => editor.state.doc.toString());
      setView(editor);

      return () => {
        unregisterText();
        saver.dispose();
        editor.destroy();
        autosaver.current = null;
        setView(null);
      };
    },
    [path, initialContent],
  );

  useEffect(() => {
    if (!view) return;
    const commands: [ScopedCommandId, () => void][] = [
      ['native.undo', () => undo(view)],
      ['native.redo', () => redo(view)],
      ['native.select_all', () => selectAll(view)],
      ['native.cut', () => document.execCommand('cut')],
      ['native.copy', () => document.execCommand('copy')],
      ['edit.find', () => openSearchPanel(view)],
    ];
    for (const [id, run] of commands) {
      registerScopedCommand(instanceId, id, () => {
        view.focus();
        run();
      });
    }
    const activate = () => useActiveEditorStore.getState().setActiveEditor(instanceId);
    view.contentDOM.addEventListener('focus', activate);
    return () => {
      view.contentDOM.removeEventListener('focus', activate);
      for (const [id] of commands) unregisterScopedCommand(instanceId, id);
      if (useActiveEditorStore.getState().activeEditorId === instanceId) {
        useActiveEditorStore.getState().setActiveEditor(null);
      }
    };
  }, [view, instanceId]);

  const text = () => view?.state.doc.toString() ?? null;

  const applyDiskContent = useCallback(
    (content: string) => {
      if (!view) return;
      const head = Math.min(view.state.selection.main.head, content.length);
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: content },
        selection: { anchor: head },
        annotations: [external.of(true)],
      });
    },
    [view],
  );

  const { status, reload, keepMine, dismiss } = useExternalFileChanges({
    path,
    ready: view !== null,
    isDirty: () => autosaver.current?.isDirty() ?? false,
    getLastWritten: () => autosaver.current?.getLastWritten() ?? initialContent,
    matchesBuffer: (disk) => disk === text(),
    applyDiskContent,
    adopt: (content) => autosaver.current?.adopt(content),
    hold: () => autosaver.current?.hold(),
    release: () => autosaver.current?.release(),
    flush: () => {
      const current = text();
      if (current === null) return;
      autosaver.current?.schedule(current);
      autosaver.current?.flush();
    },
  });

  const review = useReviewFor(path);
  const saveFailure = useSaveFailure(path);

  return (
    <>
      {status.kind !== 'none' && (
        <ExternalChangeBar
          variant={status.kind}
          onReload={reload}
          onKeepMine={() => {
            const current = text();
            keepMine();
            if (current === null) return;
            clearAbandoned(path);
            autosaver.current?.schedule(current);
            autosaver.current?.flush();
          }}
          onClose={() => {
            abandonPendingWrites(path);
            dismiss();
            useLayout.getState().closeFileTab(path);
          }}
        />
      )}
      {saveFailure && <SaveFailedBar message={saveFailure} onRetry={() => autosaver.current?.retry()} />}
      {review && <ReviewBar review={review} />}
      <div ref={attach} className='solstice-source flex-1' />
    </>
  );
}
