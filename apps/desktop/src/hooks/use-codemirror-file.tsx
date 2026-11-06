import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { redo, selectAll, undo } from '@codemirror/commands';
import { openSearchPanel, SearchQuery, setSearchQuery } from '@codemirror/search';
import { Annotation, EditorState, type Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';

import { ExternalChangeBar } from '@/components/external-change-bar';
import { SaveFailedBar } from '@/components/save-failed-bar';
import { ReviewBar } from '@/components/sync/review-bar';
import { useExternalFileChanges } from '@/hooks/use-external-file-changes';
import { useLayout } from '@/hooks/use-layout';
import { createAutosaver, type Autosaver } from '@/lib/autosave';
import { registerScopedCommand, unregisterScopedCommand, type ScopedCommandId } from '@/lib/commands';
import { useActiveEditorStore } from '@/lib/stores/active-editor';
import { registerTextSource } from '@/lib/stores/editor-text';
import { abandonPendingWrites, clearAbandoned } from '@/lib/stores/external-changes';
import { useFindStore } from '@/lib/stores/find';
import { useSaveFailure } from '@/lib/stores/save-status';
import { useReviewFor } from '@/lib/stores/sync';

/** A reload from disk, which mustn't count as an edit. */
const external = Annotation.define<boolean>();

type Options = {
  path: string;
  initialContent: string;
  /** The editor's own extensions: the first render's function is kept. */
  extensions: () => Extension[];
  /**
   * Whether sync merges this file's saves (notes): a dirty buffer is then
   * saved on an outside change rather than asking (`useExternalFileChanges`).
   */
  merges: boolean;
};

/**
 * A file in CodeMirror: autosaved, its text handed on, the native and find
 * commands scoped to it, search hits taken, and changes on disk handled, with
 * the bars for all that. Source mode and code tabs both use it.
 */
export function useCodeMirrorFile({ path, initialContent, extensions, merges }: Options): {
  attach: (parent: HTMLDivElement | null) => (() => void) | undefined;
  view: EditorView | null;
  bars: ReactNode;
} {
  const instanceId = useId();
  const autosaver = useRef<Autosaver | null>(null);
  const [view, setView] = useState<EditorView | null>(null);
  const [build] = useState(() => extensions);

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
            build(),
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
    [path, initialContent, build],
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

  // Find from the file's menu: CodeMirror's own panel, not the app's bar.
  const findAsked = useFindStore((s) => s.openPath === path);
  useEffect(() => {
    if (!view || !findAsked) return;
    useFindStore.getState().close();
    openSearchPanel(view);
  }, [view, findAsked]);

  // A full-text search hit: selected where it is, with the search panel
  // open on the search's query.
  const jumpRequest = useFindStore((s) => (s.jump?.path === path ? s.jump : null));
  useEffect(() => {
    if (!view || !jumpRequest) return;
    const taken = useFindStore.getState().takeJump(path);
    if (taken?.jump.type !== 'line') return;
    const { doc } = view.state;
    const line = doc.line(Math.min(taken.jump.line + 1, doc.lines));
    const from = Math.min(line.from + taken.jump.column, line.to);
    const to = Math.min(from + taken.length, doc.length);
    const { query, caseSensitive, wholeWord } = useFindStore.getState();
    // Opened first: it seeds its query from the selection, which this replaces.
    openSearchPanel(view);
    view.dispatch({
      selection: { anchor: from, head: to },
      effects: [
        setSearchQuery.of(new SearchQuery({ search: query, caseSensitive, wholeWord })),
        EditorView.scrollIntoView(from, { y: 'center' }),
      ],
    });
  }, [view, jumpRequest, path]);

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
    flush: merges
      ? () => {
          const current = text();
          if (current === null) return;
          autosaver.current?.schedule(current);
          autosaver.current?.flush();
        }
      : undefined,
  });

  const review = useReviewFor(path);
  const saveFailure = useSaveFailure(path);

  const bars = (
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
    </>
  );

  return { attach, view, bars };
}
