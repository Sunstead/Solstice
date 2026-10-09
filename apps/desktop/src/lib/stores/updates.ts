import { create } from 'zustand';
import { flushAllAutosavers } from '@/lib/autosave';
import { can } from '@/lib/backend/platform';
import { checkForUpdate, type AvailableUpdate } from '@/lib/backend/updater';
import { getSetting, subscribeToSetting } from '@/lib/settings/store';

const FIRST_CHECK_MS = 10_000;
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;

export type UpdateStatus =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'up-to-date' }
  | { state: 'available' }
  /** `progress` is 0-1, or null while the download's size is unknown. */
  | { state: 'installing'; progress: number | null }
  | { state: 'error'; message: string };

interface UpdatesState {
  status: UpdateStatus;
  /** The newest version found, kept through a later failed check. */
  update: AvailableUpdate | null;
  lastChecked: Date | null;
  /** A version the user said Later to; its indicator stays hidden until a newer one or a relaunch. */
  dismissed: string | null;
  dialogOpen: boolean;
  /** A background check stays quiet when it fails; a manual one opens the dialog with the answer. */
  check: (options?: { manual?: boolean }) => Promise<void>;
  install: () => Promise<void>;
  later: () => void;
  openDialog: () => void;
  closeDialog: () => void;
}

export const useUpdates = create<UpdatesState>((set, get) => ({
  status: { state: 'idle' },
  update: null,
  lastChecked: null,
  dismissed: null,
  dialogOpen: false,

  check: async ({ manual = false } = {}) => {
    const { status } = get();
    if (status.state === 'checking' || status.state === 'installing') return;
    if (manual) set({ dialogOpen: true });
    set({ status: { state: 'checking' } });
    try {
      const update = await checkForUpdate();
      set({
        update,
        lastChecked: new Date(),
        status: update ? { state: 'available' } : { state: 'up-to-date' },
      });
    } catch (err) {
      console.warn('Update check failed:', err);
      set({
        lastChecked: new Date(),
        status: manual || !get().update
          ? { state: 'error', message: String(err) }
          : { state: 'available' },
      });
    }
  },

  install: async () => {
    const { update, status } = get();
    if (!update || status.state === 'installing') return;
    set({ status: { state: 'installing', progress: null } });
    // The app quits under the editors; every edit has to be on disk first.
    if (!(await flushAllAutosavers())) {
      set({
        status: {
          state: 'error',
          message: "A note has changes that couldn't be saved. Save or resolve it, then try again.",
        },
      });
      return;
    }
    try {
      await update.install((progress) => set({ status: { state: 'installing', progress } }));
    } catch (err) {
      set({ status: { state: 'error', message: String(err) } });
    }
  },

  later: () => set((s) => ({ dismissed: s.update?.version ?? null, dialogOpen: false })),
  openDialog: () => set({ dialogOpen: true }),
  closeDialog: () => set({ dialogOpen: false }),
}));

/** Whether the title bar shows that an update is waiting. */
export function useUpdateWaiting() {
  return useUpdates((s) => s.update !== null && s.update.version !== s.dismissed);
}

/**
 * Check shortly after launch, then every few hours, while
 * `updates.autoCheck` is on. Returns the stop function.
 */
export function startBackgroundChecks(): () => void {
  if (!can.updates) return () => {};
  let timer: ReturnType<typeof setTimeout> | null = null;

  const schedule = (delay: number) => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    if (!getSetting('updates.autoCheck')) return;
    timer = setTimeout(() => {
      void useUpdates.getState().check();
      schedule(CHECK_EVERY_MS);
    }, delay);
  };

  schedule(FIRST_CHECK_MS);
  const unsubscribe = subscribeToSetting('updates.autoCheck', () => schedule(FIRST_CHECK_MS));
  return () => {
    if (timer !== null) clearTimeout(timer);
    unsubscribe();
  };
}
