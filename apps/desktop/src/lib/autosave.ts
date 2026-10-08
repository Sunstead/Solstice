import { commands, events } from '@/lib/backend';
import { getSetting, subscribeToSetting } from '@/lib/settings/store';
import { setBufferDirty } from '@/lib/stores/buffer-status';
import { clearAbandoned, isAbandoned } from '@/lib/stores/external-changes';
import { setSaveFailed, setSaving } from '@/lib/stores/save-status';
import { noteEmbedSourceWritten } from '@/lib/embed/source';

/**
 * Writes editor content back to disk according to `editor.autosave`, and
 * reports whether the file currently has unsaved changes.
 *
 * The mode and delay are read at call time, so changing either in Settings
 * takes effect on the next keystroke without remounting the editor.
 *
 * Two signals feed this. `markDirty()` comes from a ProseMirror plugin,
 * synchronously with the transaction, and drives the saving indicator — it must
 * be its own signal because Milkdown's listener debounces `markdownUpdated` by
 * 200ms, which would leave the indicator trailing every edit by that much.
 * `schedule()` carries the serialized markdown and drives the write;
 * serializing the document is the expensive half, so it stays on the slow path.
 *
 * A failed write keeps its edit and retries until one lands: on a backoff, and
 * at once when the page comes back, the network does, or sync reconnects.
 */
const RETRY_MIN_MS = 1000;
const RETRY_MAX_MS = 30_000;

export function createAutosaver(path: string, initialContent: string) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: { markdown: string; seq: number } | null = null;
  let disposed = false;
  let reported = false;
  let reportedDirty = false;
  let held = false;

  // What disk holds as far as this editor knows. Lets the external-change
  // handler recognise the events caused by our own writes.
  let lastWritten = initialContent;

  // A live editor on this path means writes are legitimate again. This is what
  // ends an abandonment -- see `abandonPendingWrites` for why it can't be a
  // timer.
  clearAbandoned(path);

  // In a synced folder, sync merges this editor's saves against exactly what
  // it holds; tell it. (Elsewhere this does nothing.)
  void commands.syncEditorOpened(path, initialContent);

  // Edits are counted, not flagged, so a write landing while newer edits are
  // queued clears only the edit it actually carried.
  let dirtySeq = 0;
  let savedSeq = 0;

  // Published on transitions only, keeping the store's per-path count balanced.
  const publish = () => {
    if (disposed) return;
    // Instant saving has no window worth showing, so it never reports.
    const active =
      getSetting('editor.autosave') !== 'change' && dirtySeq !== savedSeq;
    if (active === reported) return;
    reported = active;
    setSaving(path, active);
  };

  // Mirrors publish(), but with no autosave-mode gate: dirtiness is just as
  // real in 'change' mode, it is only too brief to be worth a spinner.
  const publishDirty = () => {
    if (disposed) return;
    const dirty = dirtySeq !== savedSeq;
    if (dirty === reportedDirty) return;
    reportedDirty = dirty;
    setBufferDirty(path, dirty);
  };

  const unsubscribe = subscribeToSetting('editor.autosave', publish);

  // The newest write started; an older one's result never overrides it.
  let latestSeq = 0;
  let failure: string | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let backoff = RETRY_MIN_MS;
  let reconnects: Promise<() => void> | null = null;

  const stopRetrying = () => {
    if (retryTimer !== null) clearTimeout(retryTimer);
    retryTimer = null;
    backoff = RETRY_MIN_MS;
    void reconnects?.then((unlisten) => unlisten());
    reconnects = null;
  };

  const retryNow = () => {
    if (failure === null || disposed) return;
    stopRetrying();
    flush();
  };

  // Sync reports often while it works; at most one early retry a second, and
  // the backoff stands, so a write that keeps failing can't spin on it.
  let nudgedAt = 0;
  const nudge = () => {
    if (failure === null || disposed || retryTimer === null) return;
    if (Date.now() - nudgedAt < RETRY_MIN_MS) return;
    nudgedAt = Date.now();
    clearTimeout(retryTimer);
    retryTimer = null;
    flush();
  };

  const failed = (markdown: string, seq: number, message: string) => {
    if (seq < latestSeq) return;
    if (pending === null && seq > savedSeq) pending = { markdown, seq };
    if (disposed) return;
    failure = message;
    setSaveFailed(path, message);
    reconnects ??= events.syncChanged.listen(nudge).catch(() => () => {});
    if (retryTimer === null) {
      retryTimer = setTimeout(() => {
        retryTimer = null;
        flush();
      }, backoff);
      backoff = Math.min(backoff * 2, RETRY_MAX_MS);
    }
  };

  const write = (markdown: string, seq: number) => {
    latestSeq = Math.max(latestSeq, seq);
    commands
      .writeFile(path, markdown)
      .then((result) => {
        // `typedError` resolves command failures rather than rejecting, so a
        // bare .catch would take a failed write for a successful one and clear
        // the indicator on a file that is still unsaved.
        if (result.status === 'error') failed(markdown, seq, result.error);
        else {
          lastWritten = markdown;
          if (seq > savedSeq) savedSeq = seq;
          if (seq >= latestSeq && failure !== null) {
            failure = null;
            setSaveFailed(path, null);
            stopRetrying();
          }
          // The watcher suppresses our own writes, so anything transcluding
          // this note has to be told about them here or it would go stale
          // exactly while the note is being edited.
          noteEmbedSourceWritten(path, markdown);
        }
      })
      .catch((err) => failed(markdown, seq, String(err)))
      .finally(() => {
        publish();
        publishDirty();
      });
  };

  const flush = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    if (pending === null) return;

    // The file was deleted or renamed away. Writing now would recreate it --
    // and `write_file` would recreate its parent directory too.
    if (isAbandoned(path)) {
      pending = null;
      return;
    }

    // Held while a conflict is on screen. The pending edit is kept, not
    // dropped, so "Keep mine" still has something to write.
    if (held) return;

    const { markdown, seq } = pending;
    pending = null;
    write(markdown, seq);
  };

  /** An edit happened. Called synchronously with the ProseMirror transaction. */
  const markDirty = () => {
    dirtySeq += 1;
    publish();
    publishDirty();
  };

  const schedule = (markdown: string) => {
    // This markdown reflects the document as of the current edit count, so that
    // is the sequence a successful write gets to clear.
    pending = { markdown, seq: dirtySeq };

    if (getSetting('editor.autosave') === 'change') {
      flush();
      return;
    }

    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(flush, getSetting('editor.autosaveDelay'));
  };

  // iOS rarely fires `beforeunload`, and backgrounding a page fires neither
  // that nor `pagehide`: hiding is the last moment that's sure to run.
  const onVisibility = () => {
    if (document.visibilityState === 'hidden') flush();
    else retryNow();
  };
  const hasPage = typeof window !== 'undefined';
  if (hasPage) {
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', flush);
    window.addEventListener('online', retryNow);
  }

  /** Flush the last edit and stop reporting; the editor calls this on unmount. */
  const dispose = () => {
    flush();
    unsubscribe();
    disposed = true;
    // A closed editor stops retrying: a late write could land over edits made
    // since in another tab. On the web the journal brings it back.
    stopRetrying();
    if (failure !== null) setSaveFailed(path, null);
    if (hasPage) {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', flush);
      window.removeEventListener('online', retryNow);
    }
    // A closed tab must not leave an indicator behind, however the write ends.
    if (reported) {
      reported = false;
      setSaving(path, false);
    }
    if (reportedDirty) {
      reportedDirty = false;
      setBufferDirty(path, false);
    }
  };

  return {
    schedule,
    markDirty,
    flush,
    dispose,

    /** Try a failed write again now, rather than when its backoff ends. */
    retry: retryNow,

    /** Whether the buffer holds edits that aren't on disk. */
    isDirty: () => dirtySeq !== savedSeq,

    /** The content this editor last put on disk, or loaded from it. */
    getLastWritten: () => lastWritten,

    /**
     * Accept `markdown` as the on-disk truth without writing it. Used after
     * reloading a file that changed externally, so the reload doesn't count as
     * an edit and immediately get written back.
     */
    adopt: (markdown: string) => {
      savedSeq = dirtySeq;
      lastWritten = markdown;
      void commands.syncEditorOpened(path, markdown);
      publish();
      publishDirty();
    },

    /**
     * Stop writing until released. Without this the conflict bar would be
     * decorative: the buffer is dirty by definition while it is showing, so
     * the running autosave timer would overwrite disk within `autosaveDelay`
     * and silently choose "keep mine" on the user's behalf.
     */
    hold: () => {
      held = true;
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    },

    release: () => {
      held = false;
    },
  };
}

export type Autosaver = ReturnType<typeof createAutosaver>;
