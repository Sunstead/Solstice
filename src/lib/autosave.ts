import { commands } from '@/bindings';
import { getSetting } from '@/lib/settings/store';
import { setSaving } from '@/lib/stores/save-status';

/**
 * Writes editor content back to disk according to `editor.autosave`.
 *
 * The mode and delay are read at call time rather than captured, so changing
 * either in Settings takes effect on the next keystroke without remounting the
 * editor. Whatever the mode, a pending write is flushed on `flush()` -- the
 * editor calls that on unmount, so closing a tab can never drop the last edit.
 *
 * While a write is queued or in flight the file is reported to
 * `useSaveStatus`, which is what puts a spinner on the tab. Only the debounced
 * mode reports: with instant saving there is no window worth showing.
 */
export function createAutosaver(
  path: string,
  onError: (message: string) => void,
) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: string | null = null;
  let inFlight = 0;
  let reported = false;

  // Published on transitions only, so the store's per-path count stays
  // balanced no matter how the waiting and in-flight phases overlap.
  const publish = () => {
    const active = timer !== null || inFlight > 0;
    if (active === reported) return;
    reported = active;
    setSaving(path, active);
  };

  const write = (markdown: string) => {
    inFlight += 1;
    commands
      .writeFile(path, markdown)
      .catch((err) => onError(String(err)))
      .finally(() => {
        inFlight -= 1;
        publish();
      });
  };

  const flush = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    if (pending === null) {
      publish();
      return;
    }
    const markdown = pending;
    pending = null;
    // Bump in-flight before publishing so the status never blinks off in the
    // handover from "waiting" to "writing".
    write(markdown);
    publish();
  };

  const schedule = (markdown: string) => {
    if (getSetting('editor.autosave') === 'change') {
      pending = null;
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      publish();
      commands
        .writeFile(path, markdown)
        .catch((err) => onError(String(err)));
      return;
    }

    pending = markdown;
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(flush, getSetting('editor.autosaveDelay'));
    publish();
  };

  return { schedule, flush };
}

export type Autosaver = ReturnType<typeof createAutosaver>;
