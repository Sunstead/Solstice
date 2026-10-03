import { create } from 'zustand';

// Keeps the stacks from growing without bound over a very long session.
const MAX_HISTORY_LENGTH = 50;

interface NavigationHistoryState {
  past: string[];
  future: string[];
  current: string | null;
  /**
   * The tab id we just programmatically navigated to via back()/forward(),
   * awaiting confirmation from the resulting `visit()` call so we know not
   * to record it as a brand new entry.
   *
   * This is cleared by the very next `visit()` call no matter what tab it
   * reports. flexlayout does not guarantee a model-change callback for
   * every `selectTab` action (e.g. when the target is already the selected
   * tab within its own, currently-inactive tabset, the action can be a
   * no-op from flexlayout's point of view). If we only cleared this flag
   * upon a matching confirmation, a missed confirmation would leave it
   * stuck `true` forever, causing the *next* unrelated visit to be
   * silently swallowed -- and the one after that consumed the stale flag,
   * recorded correctly, etc. That produces an alternating "every other
   * visit is dropped" pattern. Always clearing it here makes the
   * suppression self-healing instead.
   */
  pendingTarget: string | null;
  // Called whenever the active tab changes for any reason
  visit: (tabId: string) => void;
  /**
   * Steps backward. `isValid` reports whether a given tab id still exists
   * (e.g. `(id) => model.getNodeById(id) instanceof TabNode`); entries that
   * fail it are discarded outright rather than being carried over into
   * `future`, so a closed tab can never resurface via forward() and can
   * never leave `current` pointing at something that no longer exists.
   * Omit `isValid` to always accept the top of the stack.
   */
  back: (isValid?: (tabId: string) => boolean) => string | undefined;
  forward: (isValid?: (tabId: string) => boolean) => string | undefined;
  // Drops any past/future entries that fail `isValid`. Cheap and idempotent
  // -- safe to call after every model change to keep history reconciled
  // with whatever tabs actually still exist, however they were closed.
  prune: (isValid: (tabId: string) => boolean) => void;
  reset: () => void;
}

export const useNavigationHistory = create<NavigationHistoryState>(
  (set, get) => ({
    past: [],
    future: [],
    current: null,
    pendingTarget: null,

    visit: (tabId) => {
      const { current, pendingTarget, past } = get();

      if (pendingTarget !== null) {
        // Whatever happens below, this call resolves the pending
        // navigation one way or another -- clear it so it can never be
        // left dangling and swallow some unrelated later visit.
        set({ pendingTarget: null });

        if (tabId === pendingTarget) {
          // This is the confirmation we were waiting for -- just sync
          // `current`, don't record it as a new history entry.
          set({ current: tabId });
          return;
        }
        // The confirmation we expected never arrived (e.g. the selectTab
        // action was a no-op from flexlayout's point of view). This visit
        // is unrelated to that navigation, so fall through and record it
        // normally instead of dropping it.
      }

      if (tabId === current) return;

      set({
        past: current ? [...past, current].slice(-MAX_HISTORY_LENGTH) : past,
        future: [], // a fresh visit invalidates redo history
        current: tabId,
      });
    },

    back: (isValid = () => true) => {
      const { past, current, future } = get();

      // Walk back through the stack looking for the first still-open tab,
      // dropping any closed ones we pass along the way (they're gone, not
      // "redo-able", so they must never land in `future`).
      let remaining = past;
      let target: string | undefined;
      while (remaining.length > 0) {
        const candidate = remaining[remaining.length - 1];
        remaining = remaining.slice(0, -1);
        if (isValid(candidate)) {
          target = candidate;
          break;
        }
      }

      if (target === undefined) {
        // Nothing left to go back to -- persist the pruned stack so the
        // back button correctly disables itself instead of staying "live".
        if (remaining.length !== past.length) set({ past: remaining });
        return undefined;
      }

      set({
        past: remaining,
        future: current
          ? [current, ...future].slice(0, MAX_HISTORY_LENGTH)
          : future,
        current: target,
        pendingTarget: target,
      });
      return target;
    },

    forward: (isValid = () => true) => {
      const { future, current, past } = get();

      let remaining = future;
      let target: string | undefined;
      while (remaining.length > 0) {
        const candidate = remaining[0];
        remaining = remaining.slice(1);
        if (isValid(candidate)) {
          target = candidate;
          break;
        }
      }

      if (target === undefined) {
        if (remaining.length !== future.length) set({ future: remaining });
        return undefined;
      }

      set({
        future: remaining,
        past: current ? [...past, current].slice(-MAX_HISTORY_LENGTH) : past,
        current: target,
        pendingTarget: target,
      });
      return target;
    },

    prune: (isValid) => {
      const { past, future } = get();
      const nextPast = past.filter(isValid);
      const nextFuture = future.filter(isValid);
      if (
        nextPast.length === past.length &&
        nextFuture.length === future.length
      ) {
        return; // nothing changed -- skip the render
      }
      set({ past: nextPast, future: nextFuture });
    },

    reset: () =>
      set({ past: [], future: [], current: null, pendingTarget: null }),
  }),
);