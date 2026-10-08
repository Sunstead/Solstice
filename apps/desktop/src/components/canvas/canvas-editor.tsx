import { useCallback, useEffect, useRef, useState } from 'react';
import { FileWarning } from 'lucide-react';

import { commands } from '@/lib/backend';
import { ExternalChangeBar } from '@/components/external-change-bar';
import { SaveFailedBar } from '@/components/save-failed-bar';
import { Button } from '@sunstead/ui/components/button';
import { ViewerFrame } from '@/components/viewer/viewer-frame';
import { useExternalFileChanges } from '@/hooks/use-external-file-changes';
import { useLayout } from '@/hooks/use-layout';
import { createAutosaver, type Autosaver } from '@/lib/autosave';
import { DEFAULT_INDENT, parseCanvas, type ParseResult } from '@/lib/canvas/parse';
import { serializeCanvas } from '@/lib/canvas/serialize';
import { createCanvasStore, type CanvasStore } from '@/lib/canvas/store';
import { CanvasStoreProvider } from '@/lib/canvas/use-canvas-store';
import { abandonPendingWrites, clearAbandoned } from '@/lib/stores/external-changes';
import { useSaveFailure } from '@/lib/stores/save-status';
import { CanvasBoard } from './canvas-board';
import '@/styles/canvas.css';

/**
 * The `.canvas` tab: the only file in the feature that knows about `path`. It
 * reads the document, owns the autosaver, and hands everything below a parsed
 * board -- which is what lets one render layer serve both this and the
 * read-only preview a note embeds.
 */
export function CanvasEditor({ path }: { path: string }) {
  const [parsed, setParsed] = useState<ParseResult | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setParsed(null);
    setLoadError(null);

    void commands.readFile(path).then((result) => {
      if (cancelled) return;
      // `typedError` resolves failures rather than rejecting, so a bare
      // `.then` would try to parse the error message as a board.
      if (result.status === 'error') setLoadError(result.error);
      else setParsed(parseCanvas(result.data));
    });

    return () => {
      cancelled = true;
    };
  }, [path]);

  if (loadError !== null) {
    return (
      <ViewerFrame path={path}>
        <div className='absolute inset-0 p-4 text-sm text-destructive'>
          Failed to load: {loadError}
        </div>
      </ViewerFrame>
    );
  }

  if (parsed === null) {
    return (
      <ViewerFrame path={path}>
        <div className='absolute inset-0 p-4 text-sm text-muted-foreground'>
          Loading…
        </div>
      </ViewerFrame>
    );
  }

  if (parsed.status === 'invalid') {
    return <InvalidCanvas path={path} message={parsed.message} raw={parsed.raw} />;
  }

  // Keyed on the path, so switching files rebuilds the store and the autosaver
  // rather than reconciling one board's history onto another's document.
  return <LoadedCanvas key={path} path={path} parsed={parsed} />;
}

function LoadedCanvas({
  path,
  parsed,
}: {
  path: string;
  parsed: Extract<ParseResult, { status: 'ok' | 'empty' }>;
}) {
  const autosaver = useRef<Autosaver | null>(null);

  /**
   * The indentation the file arrived with, so writing it back does not restyle
   * it. Held in a ref rather than state: it is an attribute of the bytes on
   * disk, and nothing renders from it.
   */
  const indent = useRef(parsed.indent);

  const [store] = useState<CanvasStore>(() => {
    // Serialized rather than the raw bytes, so `getLastWritten()` compares
    // like with like even when the file arrived with a different key order.
    const initialText = serializeCanvas(parsed.doc, parsed.indent);
    const saver = createAutosaver(path, initialText);
    autosaver.current = saver;

    return createCanvasStore(parsed.doc, (next) => {
      // The two-signal split from `autosave.ts`: `markDirty` runs with the
      // change so the saving indicator never trails it, `schedule` carries the
      // bytes. Serializing a board is cheap enough to do inline.
      saver.markDirty();
      saver.schedule(serializeCanvas(next, indent.current));
    });
  });

  useEffect(() => {
    // `registerCardFlush` lands a card's text in `doc` as it stops being
    // edited, but the autosaver would still wait out `editor.autosaveDelay`.
    // Leaving a card is exactly when someone is watching for the save.
    let wasEditing = store.getState().editingNodeId !== null;
    return store.subscribe((state) => {
      const isEditing = state.editingNodeId !== null;
      if (wasEditing && !isEditing) autosaver.current?.flush();
      wasEditing = isEditing;
    });
  }, [store]);

  useEffect(() => {
    const saver = autosaver.current;
    // A tab closed mid-edit still has to land its last write; dispose flushes.
    return () => saver?.dispose();
  }, []);

  /** Semantic comparison: whitespace and key order are not a conflict. */
  const matchesBuffer = useCallback(
    (diskText: string) => {
      const disk = parseCanvas(diskText);
      if (disk.status === 'invalid') return false;
      return (
        serializeCanvas(disk.doc, DEFAULT_INDENT) ===
        serializeCanvas(store.getState().doc, DEFAULT_INDENT)
      );
    },
    [store],
  );

  const applyDiskContent = useCallback(
    (text: string) => {
      const disk = parseCanvas(text);
      // Another process mid-write leaves invalid JSON for a few milliseconds.
      // Safe to ignore: the watcher reports the completed write too.
      if (disk.status === 'invalid') return;

      indent.current = disk.indent;
      const { setView, view } = store.getState();
      // The document, not the viewport: the reader is still looking at the
      // same part of the same board.
      store.setState({ doc: disk.doc });
      setView(view);
    },
    [store],
  );

  const { status, reload, keepMine, dismiss } = useExternalFileChanges({
    path,
    ready: true,
    isDirty: () => autosaver.current?.isDirty() ?? false,
    getLastWritten: () =>
      autosaver.current?.getLastWritten() ??
      serializeCanvas(parsed.doc, parsed.indent),
    matchesBuffer,
    applyDiskContent,
    adopt: (text) => autosaver.current?.adopt(text),
    hold: () => autosaver.current?.hold(),
    release: () => autosaver.current?.release(),
  });

  // Writing the buffer back is what resolves the divergence; dismissing alone
  // would leave the board permanently out of sync with disk.
  const handleKeepMine = useCallback(() => {
    keepMine();
    // The file was abandoned when it vanished, to stop stale flushes
    // resurrecting it. Saving it back is the user asking for exactly that.
    clearAbandoned(path);
    autosaver.current?.schedule(serializeCanvas(store.getState().doc, indent.current));
    autosaver.current?.flush();
  }, [keepMine, path, store]);

  const saveFailure = useSaveFailure(path);

  const handleCloseTab = useCallback(() => {
    abandonPendingWrites(path);
    dismiss();
    useLayout.getState().closeFileTab(path);
  }, [dismiss, path]);

  return (
    <ViewerFrame path={path}>
      {(status.kind !== 'none' || saveFailure) && (
        <div className='absolute inset-x-0 top-0 z-30'>
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
        </div>
      )}

      <CanvasStoreProvider value={store}>
        <CanvasBoard path={path} />
      </CanvasStoreProvider>
    </ViewerFrame>
  );
}

/**
 * A file that is not a canvas. Deliberately inert: no store and no autosaver
 * exist in this state, so no code path can write an empty board over whatever
 * is actually in the file.
 */
function InvalidCanvas({
  path,
  message,
  raw,
}: {
  path: string;
  message: string;
  raw: string;
}) {
  const [replacing, setReplacing] = useState(false);

  return (
    <ViewerFrame path={path}>
      <div className='absolute inset-0 flex flex-col gap-3 overflow-auto p-6'>
        <div className='flex items-start gap-3'>
          <FileWarning className='mt-0.5 size-5 shrink-0 text-amber-600 dark:text-amber-400' />
          <div className='min-w-0 space-y-1'>
            <p className='text-sm font-medium'>This file isn't a valid canvas.</p>
            <p className='text-sm text-muted-foreground'>{message}</p>
            <p className='text-sm text-muted-foreground'>
              Nothing has been written to it. Fix it in a text editor, or
              replace it with an empty board.
            </p>
          </div>
        </div>

        <div>
          <Button
            variant='outline'
            size='sm'
            disabled={replacing}
            onClick={() => {
              setReplacing(true);
              void commands
                .writeFile(path, '{\n  "nodes": [],\n  "edges": []\n}\n')
                .then(() => {
                  // The watcher reports the write and the tab reloads itself.
                  setReplacing(false);
                });
            }}
          >
            Replace with an empty canvas
          </Button>
        </div>

        <pre className='min-h-0 flex-1 overflow-auto rounded-md border bg-muted/40 p-3 font-mono text-xs whitespace-pre-wrap'>
          {raw}
        </pre>
      </div>
    </ViewerFrame>
  );
}
