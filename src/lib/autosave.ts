import { commands } from '@/bindings';
import { getSetting, subscribeToSetting } from '@/lib/settings/store';
import { setSaving } from '@/lib/stores/save-status';

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
 */
export function createAutosaver(
  path: string,
  onError: (message: string) => void,
) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: { markdown: string; seq: number } | null = null;
  let disposed = false;
  let reported = false;

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

  const unsubscribe = subscribeToSetting('editor.autosave', publish);

  const write = (markdown: string, seq: number) => {
    commands
      .writeFile(path, markdown)
      .then((result) => {
        // `typedError` resolves command failures rather than rejecting, so a
        // bare .catch would take a failed write for a successful one and clear
        // the indicator on a file that is still unsaved.
        if (result.status === 'error') onError(result.error);
        else if (seq > savedSeq) savedSeq = seq;
      })
      .catch((err) => onError(String(err)))
      .finally(publish);
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

  /** An edit happened. Called synchronously with the ProseMirror transaction. */
  const markDirty = () => {
    dirtySeq += 1;
    publish();
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

  /** Flush the last edit and stop reporting; the editor calls this on unmount. */
  const dispose = () => {
    flush();
    unsubscribe();
    disposed = true;
    // A closed tab must not leave an indicator behind, however the write ends.
    if (reported) {
      reported = false;
      setSaving(path, false);
    }
  };

  return { schedule, markDirty, flush, dispose };
}

export type Autosaver = ReturnType<typeof createAutosaver>;
