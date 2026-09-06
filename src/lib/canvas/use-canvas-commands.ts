import { useCallback, useEffect, useId } from 'react';

import {
  registerScopedCommand,
  unregisterScopedCommand,
  type ScopedCommandId,
} from '@/lib/commands';
import { getSetting, setSetting } from '@/lib/settings/store';
import { useActiveEditorStore } from '@/lib/stores/active-editor';
import type { CanvasStore } from './store';

export interface CanvasCommandHandlers {
  store: CanvasStore;
  fit: () => void;
  zoomToSelection: () => void;
  newTextCard: () => void;
  newFileCard: () => void;
  newGroup: () => void;
}

/** A handler, plus the predicate the Edit menu greys the item by. */
type Entry = { run: () => void; isEnabled?: () => boolean };

/**
 * Wires a board into the app's command system.
 *
 * Holding the active-editor seat is a correctness requirement, not polish:
 * `milkdown-editor.tsx` registers `native.undo` as a scoped id, so `resolveEntry`
 * never consults the global map again for the life of the app. A board without
 * the seat has a Cmd+Z that resolves to nothing.
 *
 * Claim and release are asymmetric, following `pdf-viewer.tsx`: claim only when
 * the seat is empty, so a tab mounting in the background never steals it;
 * release only on unmount, since a menu click blurs the surface to open the menu.
 */
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
   * Takes the seat outright, for the board's own focus handler. The mount-time
   * claim below only fires when the seat is empty, which is right for a
   * background tab but would leave a clicked board resolving every scoped
   * command to whichever note editor was focused last.
   */
  const claimSeat = useCallback(() => {
    if (useActiveEditorStore.getState().activeEditorId === scopeId) return;
    useActiveEditorStore.getState().setActiveEditor(scopeId);
  }, [scopeId]);

  useEffect(() => {
    const state = () => store.getState();

    const entries: Partial<Record<ScopedCommandId, Entry>> = {
      'native.undo': { run: () => state().undo(), isEnabled: () => state().canUndo() },
      'native.redo': { run: () => state().redo(), isEnabled: () => state().canRedo() },
      'native.select_all': {
        run: () =>
          state().select(
            state().doc.nodes.map((node) => node.id),
            'replace',
          ),
      },

      'canvas.new_text': { run: newTextCard },
      'canvas.new_file': { run: newFileCard },
      'canvas.new_group': { run: newGroup },
      'canvas.zoom_to_fit': { run: fit },
      'canvas.zoom_to_selection': {
        run: zoomToSelection,
        isEnabled: () => state().selection.size > 0,
      },
      'canvas.toggle_snap': {
        run: () => setSetting('canvas.snapToGrid', !getSetting('canvas.snapToGrid')),
      },
      'canvas.toggle_minimap': {
        run: () => setSetting('canvas.showMinimap', !getSetting('canvas.showMinimap')),
      },

      // `edit.find` and the `edit.*` formatting commands are deliberately
      // absent. An unregistered id still resolves to this scope and finds no
      // handler, so Cmd+F over a board does nothing rather than reaching back
      // into whichever note editor was focused last.
    };

    for (const [id, entry] of Object.entries(entries) as [ScopedCommandId, Entry][]) {
      registerScopedCommand(scopeId, id, entry.run, entry.isEnabled);
    }

    if (useActiveEditorStore.getState().activeEditorId === null) {
      useActiveEditorStore.getState().setActiveEditor(scopeId);
    }

    // `AppMenubar` recomputes `isCommandEnabled()` on render and has no
    // subscription of its own, so a change to one of those answers must say so.
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
      for (const id of Object.keys(entries)) {
        unregisterScopedCommand(scopeId, id as ScopedCommandId);
      }
      if (useActiveEditorStore.getState().activeEditorId === scopeId) {
        useActiveEditorStore.getState().setActiveEditor(null);
      }
    };
  }, [scopeId, store, fit, zoomToSelection, newTextCard, newFileCard, newGroup]);

  return { scopeId, claimSeat };
}
