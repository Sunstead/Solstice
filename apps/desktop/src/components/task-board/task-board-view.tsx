import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useStore } from 'zustand';

import { commands } from '@/lib/backend';
import { ExternalChangeBar } from '@/components/external-change-bar';
import { SaveFailedBar } from '@/components/save-failed-bar';
import { ViewerFrame } from '@/components/viewer/viewer-frame';
import { useExternalFileChanges } from '@/hooks/use-external-file-changes';
import { useLayout } from '@/hooks/use-layout';
import { createAutosaver, type Autosaver } from '@/lib/autosave';
import { registerScopedCommand, unregisterScopedCommand } from '@/lib/commands';
import { warmStaticRenderer } from '@/lib/editor/static-markdown';
import { useActiveEditorStore } from '@/lib/stores/active-editor';
import { registerTextSource, takeHandoff } from '@/lib/stores/editor-text';
import { abandonPendingWrites, clearAbandoned } from '@/lib/stores/external-changes';
import { useSaveFailure } from '@/lib/stores/save-status';
import { createBoardStore, onBoardEdit, type BoardStore } from '@/lib/task-board/store';
import { Board } from './board';
import '@/styles/task-board.css';

/**
 * A `*.task.md` tab: the note as a board. Reads the note (or the text source
 * mode hands over), owns its autosaver, and gives the board a store of the
 * text; `view.toggle_source_mode` swaps it for the raw markdown.
 */
export function TaskBoardView({ path }: { path: string }) {
  // `FileView` keys this by path, so `path` never changes under it.
  const [text, setText] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    warmStaticRenderer();

    // Source mode's last save may still be on its way: start from its text.
    const handed = takeHandoff(path);
    const read =
      handed !== null
        ? Promise.resolve({ status: 'ok' as const, data: handed })
        : commands.readFile(path);
    void read.then((result) => {
      if (cancelled) return;
      if (result.status === 'error') setLoadError(result.error);
      else setText(result.data);
    });

    return () => {
      cancelled = true;
    };
  }, [path]);

  if (loadError !== null) {
    return (
      <ViewerFrame path={path}>
        <div className='absolute inset-0 p-4 text-sm text-destructive select-text'>Failed to load: {loadError}</div>
      </ViewerFrame>
    );
  }

  if (text === null) {
    return (
      <ViewerFrame path={path}>
        <div className='absolute inset-0 p-4 text-sm text-muted-foreground'>Loading…</div>
      </ViewerFrame>
    );
  }

  return <LoadedBoard path={path} initialText={text} />;
}

function LoadedBoard({ path, initialText }: { path: string; initialText: string }) {
  const [store] = useState<BoardStore>(() => createBoardStore(initialText));
  // Made and disposed in one effect, so StrictMode's second mount gets a live one.
  const saverRef = useRef<Autosaver | null>(null);

  useEffect(() => {
    const saver = createAutosaver(path, store.getState().text);
    saverRef.current = saver;
    const unsubscribe = onBoardEdit(store, (text) => {
      // Each board action is a whole change, so it's written at once rather
      // than after the typing delay.
      saver.markDirty();
      saver.schedule(text);
      saver.flush();
    });
    return () => {
      unsubscribe();
      // A tab closed mid-save still has to land its last write; dispose flushes.
      saver.dispose();
      saverRef.current = null;
    };
  }, [path, store]);

  useEffect(() => registerTextSource(path, () => store.getState().text), [path, store]);

  const { claimSeat } = useBoardCommands(store);

  const applyDiskContent = useCallback((text: string) => store.getState().load(text), [store]);

  const { status, reload, keepMine, dismiss } = useExternalFileChanges({
    path,
    ready: true,
    isDirty: () => saverRef.current?.isDirty() ?? false,
    getLastWritten: () => saverRef.current?.getLastWritten() ?? store.getState().text,
    matchesBuffer: (diskText) => diskText === store.getState().text,
    applyDiskContent,
    adopt: (text) => saverRef.current?.adopt(text),
    hold: () => saverRef.current?.hold(),
    release: () => saverRef.current?.release(),
    // A note merges: in a synced folder, save and take the merge back.
    flush: () => {
      saverRef.current?.schedule(store.getState().text);
      saverRef.current?.flush();
    },
  });

  const handleKeepMine = useCallback(() => {
    keepMine();
    clearAbandoned(path);
    saverRef.current?.schedule(store.getState().text);
    saverRef.current?.flush();
  }, [keepMine, path, store]);

  const saveFailure = useSaveFailure(path);

  const handleCloseTab = useCallback(() => {
    abandonPendingWrites(path);
    dismiss();
    useLayout.getState().closeFileTab(path);
  }, [dismiss, path]);

  return (
    <ViewerFrame path={path} onPointerDownCapture={claimSeat} onFocusCapture={claimSeat}>
      {(status.kind !== 'none' || saveFailure) && (
        <div className='absolute inset-x-0 top-0 z-30'>
          {status.kind !== 'none' && (
            <ExternalChangeBar variant={status.kind} onReload={reload} onKeepMine={handleKeepMine} onClose={handleCloseTab} />
          )}
          {saveFailure && <SaveFailedBar message={saveFailure} onRetry={() => saverRef.current?.retry()} />}
        </div>
      )}
      <Board path={path} store={store} />
    </ViewerFrame>
  );
}

/**
 * Undo and redo for the board, through the app's scoped commands (as
 * `use-canvas-commands.ts` does, and for the same reason: once any editor
 * registers `native.undo` as scoped, a surface without the seat has none).
 * Other scoped ids resolve here and do nothing, so Cmd+F or Cmd+B over a
 * board never reaches back into the last note.
 */
function useBoardCommands(store: BoardStore): { claimSeat: () => void } {
  const scopeId = useId();
  const canUndo = useStore(store, (s) => s.history.past.length > 0);
  const canRedo = useStore(store, (s) => s.history.future.length > 0);

  const claimSeat = useCallback(() => {
    if (useActiveEditorStore.getState().activeEditorId !== scopeId) {
      useActiveEditorStore.getState().setActiveEditor(scopeId);
    }
  }, [scopeId]);

  useEffect(() => {
    registerScopedCommand(
      scopeId,
      'native.undo',
      () => store.getState().undo(),
      () => store.getState().history.past.length > 0,
    );
    registerScopedCommand(
      scopeId,
      'native.redo',
      () => store.getState().redo(),
      () => store.getState().history.future.length > 0,
    );
    if (useActiveEditorStore.getState().activeEditorId === null) {
      useActiveEditorStore.getState().setActiveEditor(scopeId);
    }
    return () => {
      unregisterScopedCommand(scopeId, 'native.undo');
      unregisterScopedCommand(scopeId, 'native.redo');
      if (useActiveEditorStore.getState().activeEditorId === scopeId) {
        useActiveEditorStore.getState().setActiveEditor(null);
      }
    };
  }, [scopeId, store]);

  // The Edit menu greys Undo and Redo from these, with no subscription of its own.
  useEffect(() => {
    useActiveEditorStore.getState().bumpCommandVersion();
  }, [canUndo, canRedo]);

  return { claimSeat };
}
