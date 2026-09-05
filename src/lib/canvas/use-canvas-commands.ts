import { useCallback, useEffect, useId } from 'react';

import {
  registerScopedCommand,
  unregisterScopedCommand,
  type ScopedCommandId,
} from '@/lib/commands';
import { getSetting, setSetting } from '@/lib/settings/store';
import { useActiveEditorStore } from '@/lib/stores/active-editor';
import type { CanvasStore } from './store';

/**
 * Wires a board into the app's command system.
 *
 * Holding the active-editor seat is a *correctness* requirement here, not
 * polish. `milkdown-editor.tsx` registers `native.undo` as a scoped id, so
 * `resolveEntry` sees at least one scope has claimed it and never consults the
 * global map again -- for the whole life of the app. A board that failed to
 * hold the seat would have a Cmd+Z that resolves to nothing and logs a warning,
 * which is a very quiet way to lose someone's work.
 *
 * The claim/release rules are `pdf-viewer.tsx`'s, and are asymmetric on
 * purpose: claim only when the seat is empty, so a background tab mounting
 * never steals it from a focused editor; release only on unmount, because a
 * menu click blurs the surface to open the menu and clearing on blur would
 * leave that click with no target at all.
 */
export interface CanvasCommandHandlers {
  store: CanvasStore;
  fit: () => void;
  zoomToSelection: () => void;
  newTextCard: () => void;
  newFileCard: () => void;
  newGroup: () => void;
}

export function useCanvasCommands({
  store,
  fit,
  zoomToSelection,
  newTextCard,
  newFileCard,
  newGroup,
}: CanvasCommandHandlers): { scopeId: string; claimSeat: () => void } {
  const scopeId = useId();

  /**
   * Takes the seat outright, for the board's own focus handler.
   *
   * The mount-time claim only fires when the seat is empty, which is right for
   * a tab opening in the background but wrong once someone actually clicks the
   * board: whichever note editor was focused last would otherwise keep the
   * seat, and every scoped command -- including the Edit menu's Undo -- would
   * still resolve to it. Claiming is always safe; only *clearing* has to be
   * careful, which is why that stays on unmount.
   */
  const claimSeat = useCallback(() => {
    if (useActiveEditorStore.getState().activeEditorId === scopeId) return;
    useActiveEditorStore.getState().setActiveEditor(scopeId);
  }, [scopeId]);

  useEffect(() => {
    const state = () => store.getState();

    const handlers: Partial<Record<ScopedCommandId, () => void>> = {
      'native.undo': () => state().undo(),
      'native.redo': () => state().redo(),
      'native.select_all': () =>
        state().select(
          state().doc.nodes.map((node) => node.id),
          'replace',
        ),

      'canvas.new_text': newTextCard,
      'canvas.new_file': newFileCard,
      'canvas.new_group': newGroup,
      'canvas.zoom_to_fit': fit,
      'canvas.zoom_to_selection': zoomToSelection,
      'canvas.toggle_snap': () =>
        setSetting('canvas.snapToGrid', !getSetting('canvas.snapToGrid')),
      'canvas.toggle_minimap': () =>
        setSetting('canvas.showMinimap', !getSetting('canvas.showMinimap')),

      // `edit.find` is deliberately absent, as are the `edit.*` formatting
      // commands. An id left unregistered still resolves to this scope and
      // finds no handler, which is exactly right: Cmd+F or Cmd+B over a board
      // should do nothing rather than reach back into whichever note editor
      // happened to be focused last.
    };

    for (const [id, handler] of Object.entries(handlers)) {
      registerScopedCommand(scopeId, id as ScopedCommandId, handler);
    }

    // Re-registered with predicates, so the Edit menu greys them correctly.
    registerScopedCommand(scopeId, 'native.undo', handlers['native.undo']!, () =>
      state().canUndo(),
    );
    registerScopedCommand(scopeId, 'native.redo', handlers['native.redo']!, () =>
      state().canRedo(),
    );
    registerScopedCommand(
      scopeId,
      'canvas.zoom_to_selection',
      zoomToSelection,
      () => state().selection.size > 0,
    );

    if (useActiveEditorStore.getState().activeEditorId === null) {
      useActiveEditorStore.getState().setActiveEditor(scopeId);
    }

    // `AppMenubar` recomputes `isCommandEnabled()` on render and has no
    // subscription of its own, so anything that changes one of those answers
    // has to say so explicitly.
    const unsubscribe = store.subscribe((next, previous) => {
      if (
        next.selection !== previous.selection ||
        next.history !== previous.history
      ) {
        useActiveEditorStore.getState().bumpCommandVersion();
      }
    });

    return () => {
      unsubscribe();
      for (const id of Object.keys(handlers)) {
        unregisterScopedCommand(scopeId, id as ScopedCommandId);
      }
      if (useActiveEditorStore.getState().activeEditorId === scopeId) {
        useActiveEditorStore.getState().setActiveEditor(null);
      }
    };
  }, [scopeId, store, fit, zoomToSelection, newTextCard, newFileCard, newGroup]);

  return { scopeId, claimSeat };
}
