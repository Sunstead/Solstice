import { commands } from '@/bindings';
import { getSetting, subscribeToSetting } from '@/lib/settings/store';
import { setSaving } from '@/lib/stores/save-status';

/**
 * Writes editor content back to disk according to `editor.autosave`, and
 * reports whether the file currently has unsaved changes.
 *
 * The mode and delay are read at call time rather than captured, so changing
 * either in Settings takes effect on the next keystroke without remounting the
 * editor. A pending write is flushed on `dispose()` -- the editor calls that
 * on unmount, so closing a tab can never drop the last edit.
 *
 * Two separate signals feed this, deliberately:
 *
 * - `markDirty()` is called from a ProseMirror plugin, synchronously with the
 *   transaction, and is what drives the tab's saving indicator. It has to be
 *   its own signal because Milkdown's listener plugin debounces
 *   `markdownUpdated` by 200ms internally -- deriving "unsaved" from the write
 *   schedule would leave the indicator lagging every edit by that much.
 * - `schedule()` carries the serialized markdown and drives the actual write.
 *   Serializing the whole document is the expensive part, which is exactly why
 *   Milkdown debounces it, so it stays on the slow path.
 */
export function createAutosaver(
  path: string,
  onError: (message: string) => void,
) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: { markdown: string; seq: number } | null = null;
  let inFlight = 0;
  let disposed = false;

  // Edits are counted rather than flagged so a write that lands while newer
  // edits are already queued does not mark the file clean: a write only clears
  // the edit it actually carried.
  let dirtySeq = 0;
  let savedSeq = 0;

  let reported = false;

  const isDirty = () => dirtySeq !== savedSeq;

  // Published on transitions only, so the store's per-path count stays
  // balanced no matter how the waiting and in-flight phases overlap.
  const publish = () => {
    if (disposed) return;
    // Instant saving has no window worth showing, so it never reports.
    const active = getSetting('editor.autosave') !== 'change' && isDirty();
    if (active === reported) return;
    reported = active;
    setSaving(path, active);
  };

  // Switching modes changes whether the current state is worth showing.
  const unsubscribe = subscribeToSetting('editor.autosave', publish);

  const write = (markdown: string, seq: number) => {
    inFlight += 1;
    commands
      .writeFile(path, markdown)
      .then((result) => {
        // `typedError` resolves command failures as { status: 'error' } and
        // only rethrows transport-level Errors, so a plain .catch would let a
        // failed write pass for a successful one -- clearing the indicator and
        // losing the message on a file that is still unsaved.
        if (result.status === 'error') {
          onError(result.error);
          return;
        }
        // Only this edit is now on disk; anything typed since stays dirty.
        if (seq > savedSeq) savedSeq = seq;
      })
      .catch((err) => onError(String(err)))
      .finally(() => {
        inFlight -= 1;
        publish();
      });
  };

  /** An edit happened. Called synchronously with the ProseMirror transaction. */
  const markDirty = () => {
    dirtySeq += 1;
    publish();
  };

  const flush = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    if (pending === null) return;
    const { markdown, seq } = pending;
    pending = null;
    write(markdown, seq);
  };

  const schedule = (markdown: string) => {
    // This markdown reflects the document as of the current edit count, so
    // that is the sequence a successful write gets to clear.
    pending = { markdown, seq: dirtySeq };

    if (getSetting('editor.autosave') === 'change') {
      flush();
      return;
    }

    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(flush, getSetting('editor.autosaveDelay'));
  };

  /** Flush the last edit and stop reporting. The editor calls this on unmount. */
  const dispose = () => {
    flush();
    unsubscribe();
    disposed = true;
    // A closed tab must not leave an indicator behind, however the final
    // write turns out.
    if (reported) {
      reported = false;
      setSaving(path, false);
    }
  };

  return { schedule, markDirty, flush, dispose };
}

export type Autosaver = ReturnType<typeof createAutosaver>;
